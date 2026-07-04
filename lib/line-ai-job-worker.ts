import { db } from "@/lib/db";
import {
  LineAiJobStatus,
  LineIntent,
  LineMessageType,
} from "@/lib/generated/prisma";
import { getLineAiSettings } from "@/lib/line-ai-settings";
import {
  appendLineMessage,
  markOutboundLineMessageSent,
  storeLineAiAudit,
  storeLineAiJob,
  storeLineAiSuggestion,
  updateLineAiJob,
  updateLineConversationState,
} from "@/lib/line-conversation-repository";
import { getLineProductSummaries, searchLineProductInquiry } from "@/lib/chat-core/product-search-bridge";
import { pushLineMessages, replyLineMessage } from "@/lib/line-messaging";
import {
  processLineAiReply,
  recoverStalledCoalescedConversations,
  type LineWebhookProcessorConfig,
  type LineWebhookProcessorDependencies,
} from "@/lib/line-webhook-processor";
import type { LineImageClassification } from "@/lib/line-image-service";

type QueuedLineAiJobPayload = {
  lineEventId?: string | null;
  lineUserId?: string | null;
  replyToken?: string | null;
  canReply?: boolean;
  messageType?: LineMessageType;
  text?: string | null;
  route?: {
    intent: LineIntent;
    allowsSearch: boolean;
    requiresAdmin: boolean;
    requiresImageAnalysis: boolean;
    requiresMoreInfo: boolean;
    reason: string;
  };
  imageClassification?: LineImageClassification | null;
};

type ValidQueuedLineAiJobPayload = QueuedLineAiJobPayload & {
  lineUserId: string;
  messageType: LineMessageType;
  route: NonNullable<QueuedLineAiJobPayload["route"]>;
};

const workerDependencies: LineWebhookProcessorDependencies = {
  hasProcessedLineEvent: async () => false,
  findActiveCustomerIdByLineUserId: async () => null,
  getOrCreateLineConversation: async (input) => {
    throw new Error(`Unexpected conversation creation in LINE AI job worker for ${input.lineUserId}`);
  },
  appendLineMessage,
  updateLineConversationState,
  storeLineAiAudit,
  storeLineAiSuggestion,
  markOutboundLineMessageSent,
  storeLineAiJob,
  updateLineAiJob,
  searchLineProductInquiry,
  getLineProductSummaries,
  replyLineMessage,
  pushLineMessages,
};

function parseQueuedPayload(payload: unknown): ValidQueuedLineAiJobPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as QueuedLineAiJobPayload;
  if (!candidate.lineUserId || !candidate.route || !candidate.messageType) return null;
  return candidate as ValidQueuedLineAiJobPayload;
}

export async function processPendingLineAiJobs(input?: {
  take?: number;
  channelAccessToken?: string | null;
  config?: Partial<LineWebhookProcessorConfig>;
  dependencies?: LineWebhookProcessorDependencies;
}) {
  const take = Math.min(Math.max(input?.take ?? 10, 1), 25);
  const aiSettings = await getLineAiSettings();
  const stalePendingBefore = new Date(Date.now() - 60_000);
  const staleProcessingBefore = new Date(Date.now() - 2 * 60_000);

  const staleProcessing = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "LineAiJob"
    SET
      status = 'FAILED'::"LineAiJobStatus",
      error = 'STALE_PROCESSING_TIMEOUT',
      "finishedAt" = NOW()
    WHERE status = 'PROCESSING'::"LineAiJobStatus"
      AND "finishedAt" IS NULL
      AND COALESCE("startedAt", "createdAt") < ${staleProcessingBefore}
    RETURNING id`;

  // Atomic claim: lock and flip PENDING → PROCESSING in one statement so two
  // overlapping cron runs (or a cron racing the inline webhook handler) can
  // never pick the same job. `SKIP LOCKED` keeps each runner moving past rows
  // another worker already holds.
  const claimed = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "LineAiJob"
    SET status = 'PROCESSING'::"LineAiJobStatus", "startedAt" = NOW()
    WHERE id IN (
      SELECT id FROM "LineAiJob"
      WHERE status = 'PENDING'::"LineAiJobStatus"
        AND "createdAt" < ${stalePendingBefore}
      ORDER BY "createdAt" ASC
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;

  const jobs = claimed.length
    ? await db.lineAiJob.findMany({
        where: { id: { in: claimed.map((row) => row.id) } },
        orderBy: { createdAt: "asc" },
        include: {
          conversation: true,
          lineMessage: true,
        },
      })
    : [];

  const summary = {
    picked: jobs.length,
    completed: 0,
    failed: 0,
    staleProcessingFailed: staleProcessing.length,
    skipped: 0,
    replied: 0,
  };

  for (const job of jobs) {
    const payload = parseQueuedPayload(job.payload);
    if (!payload || !job.lineMessage) {
      await updateLineAiJob(job.id, {
        status: LineAiJobStatus.SKIPPED,
        error: "INVALID_LINE_AI_JOB_PAYLOAD",
        finishedAt: new Date(),
      });
      summary.skipped += 1;
      continue;
    }

    try {
      const result = await processLineAiReply(
        {
          jobId: job.id,
          conversation: job.conversation,
          inboundMessage: job.lineMessage,
          lineUserId: payload.lineUserId,
          replyToken: payload.replyToken ?? null,
          canReply: payload.canReply ?? false,
          messageType: payload.messageType,
          route: payload.route,
          text: payload.text ?? null,
          imageClassification: payload.imageClassification ?? null,
          lineEventId: payload.lineEventId ?? null,
        },
        {
          channelAccessToken: input?.channelAccessToken ?? input?.config?.channelAccessToken ?? null,
          autoReplyEnabled: input?.config?.autoReplyEnabled ?? aiSettings.autoReplyEnabled,
          dryRun: input?.config?.dryRun ?? aiSettings.dryRun,
          imageSearchEnabled: input?.config?.imageSearchEnabled ?? aiSettings.imageSearchEnabled,
          allowPushFallback: input?.config?.allowPushFallback ?? true,
          receivedAt: job.lineMessage.createdAt,
          replyTokenMaxAgeMs: input?.config?.replyTokenMaxAgeMs ?? 45_000,
        },
        input?.dependencies ?? workerDependencies,
      );
      summary.completed += 1;
      if (result.replied) summary.replied += 1;
    } catch (error) {
      console.error("[line-ai-job-worker] job failed", job.id, error);
      summary.failed += 1;
    }
  }

  // Coalescing crash failsafe: re-run the owner loop for any conversation left
  // with unanswered customer messages and no live owner (e.g. the webhook's
  // after() invocation died mid-burst). The lock + quiet window prevent racing a
  // still-running live owner, so this never duplicates a reply.
  const recovery = await recoverStalledCoalescedConversations(
    {
      channelAccessToken: input?.channelAccessToken ?? input?.config?.channelAccessToken ?? null,
      autoReplyEnabled: input?.config?.autoReplyEnabled ?? aiSettings.autoReplyEnabled,
      dryRun: input?.config?.dryRun ?? aiSettings.dryRun,
      imageSearchEnabled: input?.config?.imageSearchEnabled ?? aiSettings.imageSearchEnabled,
      allowPushFallback: input?.config?.allowPushFallback ?? true,
      replyTokenMaxAgeMs: input?.config?.replyTokenMaxAgeMs ?? 45_000,
      coalesce: true,
    },
    input?.dependencies ?? workerDependencies,
  ).catch((error) => {
    console.error("[line-ai-job-worker] coalesce recovery failed", error);
    return { scanned: 0, replied: 0 };
  });
  summary.replied += recovery.replied;

  return summary;
}
