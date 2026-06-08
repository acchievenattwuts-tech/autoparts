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
import { getLineProductSummaries, searchLineProductInquiry } from "@/lib/line-product-search-bridge";
import { pushLineMessages, replyLineMessage } from "@/lib/line-messaging";
import {
  processLineAiReply,
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
  const jobs = await db.lineAiJob.findMany({
    where: {
      status: LineAiJobStatus.PENDING,
      createdAt: { lt: stalePendingBefore },
    },
    orderBy: { createdAt: "asc" },
    take,
    include: {
      conversation: true,
      lineMessage: true,
    },
  });

  const summary = {
    picked: jobs.length,
    completed: 0,
    failed: 0,
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

  return summary;
}
