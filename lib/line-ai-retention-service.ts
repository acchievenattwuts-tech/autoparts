import { LineAiJobStatus, Prisma } from "@/lib/generated/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

export const LINE_AI_AUDIT_RETENTION_DAYS = 60;
export const LINE_AI_JOB_COMPLETED_OR_SKIPPED_RETENTION_DAYS = 30;
export const LINE_AI_JOB_FAILED_RETENTION_DAYS = 60;
export const LINE_AI_SUGGESTION_RETENTION_DAYS = 60;
// LineMessage rows (and their text) are kept forever; only the raw LINE webhook
// payload (`rawEvent`) is cleared once it is older than this. Nothing in the app
// reads rawEvent back — the admin inbox renders from text/imageUrl/messageType.
export const LINE_MESSAGE_RAW_EVENT_RETENTION_DAYS = 90;
// Batched so one daily run never holds a long UPDATE lock or runs past the cron
// function's time limit; a backlog larger than one run's cap drains over the
// following days.
export const LINE_MESSAGE_RAW_EVENT_CLEAR_BATCH_SIZE = 500;
export const LINE_MESSAGE_RAW_EVENT_CLEAR_MAX_BATCHES = 40;
export const LINE_MESSAGE_RAW_EVENT_CLEAR_TIME_BUDGET_MS = 20_000;

type CleanupLineAiRetentionDeps = {
  deleteAuditLogsOlderThan: (cutoff: Date) => Promise<number>;
  deleteJobsOlderThan: (statuses: LineAiJobStatus[], cutoff: Date) => Promise<number>;
  deleteSuggestionsOlderThan: (cutoff: Date) => Promise<number>;
  clearLineMessageRawEventsOlderThan: (cutoff: Date) => Promise<number>;
};

export type CleanupLineAiRetentionSummary = {
  deletedAuditLogs: number;
  deletedJobsCompletedOrSkipped: number;
  deletedJobsFailed: number;
  deletedSuggestions: number;
  clearedLineMessageRawEvents: number;
};

type RawEventClearBatchDeps = {
  /** Ids of LineMessage rows older than `cutoff` that still carry a rawEvent. */
  findIdsWithRawEvent: (cutoff: Date, take: number) => Promise<string[]>;
  /** Sets rawEvent to SQL NULL for these ids; returns the number of rows updated. */
  clearRawEvent: (ids: string[]) => Promise<number>;
  nowMs?: () => number;
  batchSize?: number;
  maxBatches?: number;
  timeBudgetMs?: number;
};

export type RawEventClearResult = {
  cleared: number;
  batches: number;
  /** True when the run stopped on the batch/time cap with rows possibly left over. */
  capped: boolean;
};

/**
 * Clears `LineMessage.rawEvent` older than `cutoff` in batches of
 * `batchSize`, stopping after `maxBatches` or `timeBudgetMs`, whichever first.
 * Only the rawEvent column changes; the message row and its text are kept.
 */
export async function clearLineMessageRawEventsInBatches(
  cutoff: Date,
  deps: RawEventClearBatchDeps,
): Promise<RawEventClearResult> {
  const nowMs = deps.nowMs ?? Date.now;
  const batchSize = deps.batchSize ?? LINE_MESSAGE_RAW_EVENT_CLEAR_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? LINE_MESSAGE_RAW_EVENT_CLEAR_MAX_BATCHES;
  const timeBudgetMs = deps.timeBudgetMs ?? LINE_MESSAGE_RAW_EVENT_CLEAR_TIME_BUDGET_MS;
  const startedAt = nowMs();

  let cleared = 0;
  let batches = 0;
  while (batches < maxBatches) {
    if (nowMs() - startedAt >= timeBudgetMs) {
      return { cleared, batches, capped: true };
    }
    const ids = await deps.findIdsWithRawEvent(cutoff, batchSize);
    if (ids.length === 0) return { cleared, batches, capped: false };

    cleared += await deps.clearRawEvent(ids);
    batches += 1;
    if (ids.length < batchSize) return { cleared, batches, capped: false };
  }
  return { cleared, batches, capped: true };
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

async function deleteAuditLogsOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.lineAiAuditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

async function deleteJobsOlderThan(statuses: LineAiJobStatus[], cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.lineAiJob.deleteMany({
    where: {
      status: { in: statuses },
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteSuggestionsOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.lineAiSuggestion.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

async function clearLineMessageRawEventsOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await clearLineMessageRawEventsInBatches(cutoff, {
    findIdsWithRawEvent: async (olderThan, take) => {
      const rows = await db.lineMessage.findMany({
        where: { createdAt: { lt: olderThan }, rawEvent: { not: Prisma.DbNull } },
        select: { id: true },
        take,
      });
      return rows.map((row) => row.id);
    },
    clearRawEvent: async (ids) => {
      const updated = await db.lineMessage.updateMany({
        where: { id: { in: ids } },
        data: { rawEvent: Prisma.DbNull },
      });
      return updated.count;
    },
  });
  console.info("[line-ai-retention] cleared LineMessage.rawEvent", {
    olderThan: cutoff.toISOString(),
    cleared: result.cleared,
    batches: result.batches,
    capped: result.capped,
  });
  return result.cleared;
}

const defaultDeps: CleanupLineAiRetentionDeps = {
  deleteAuditLogsOlderThan,
  deleteJobsOlderThan,
  deleteSuggestionsOlderThan,
  clearLineMessageRawEventsOlderThan,
};

export async function cleanupLineAiRetention(
  input: Partial<CleanupLineAiRetentionDeps> & { now?: Date } = {},
): Promise<CleanupLineAiRetentionSummary> {
  const now = input.now ?? new Date();
  const deps = {
    ...defaultDeps,
    ...input,
  };

  const auditCutoff = daysAgo(now, LINE_AI_AUDIT_RETENTION_DAYS);
  const completedOrSkippedCutoff = daysAgo(now, LINE_AI_JOB_COMPLETED_OR_SKIPPED_RETENTION_DAYS);
  const failedCutoff = daysAgo(now, LINE_AI_JOB_FAILED_RETENTION_DAYS);
  const suggestionCutoff = daysAgo(now, LINE_AI_SUGGESTION_RETENTION_DAYS);

  const deletedAuditLogs = await deps.deleteAuditLogsOlderThan(auditCutoff);
  const deletedJobsCompletedOrSkipped = await deps.deleteJobsOlderThan(
    [LineAiJobStatus.COMPLETED, LineAiJobStatus.SKIPPED],
    completedOrSkippedCutoff,
  );
  const deletedJobsFailed = await deps.deleteJobsOlderThan([LineAiJobStatus.FAILED], failedCutoff);
  const deletedSuggestions = await deps.deleteSuggestionsOlderThan(suggestionCutoff);
  const clearedLineMessageRawEvents = await deps.clearLineMessageRawEventsOlderThan(
    daysAgo(now, LINE_MESSAGE_RAW_EVENT_RETENTION_DAYS),
  );

  return {
    deletedAuditLogs,
    deletedJobsCompletedOrSkipped,
    deletedJobsFailed,
    deletedSuggestions,
    clearedLineMessageRawEvents,
  };
}
