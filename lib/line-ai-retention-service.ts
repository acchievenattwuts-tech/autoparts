import { LineAiJobStatus } from "@/lib/generated/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

export const LINE_AI_AUDIT_RETENTION_DAYS = 60;
export const LINE_AI_JOB_COMPLETED_OR_SKIPPED_RETENTION_DAYS = 30;
export const LINE_AI_JOB_FAILED_RETENTION_DAYS = 60;
export const LINE_AI_SUGGESTION_RETENTION_DAYS = 60;

type CleanupLineAiRetentionDeps = {
  deleteAuditLogsOlderThan: (cutoff: Date) => Promise<number>;
  deleteJobsOlderThan: (statuses: LineAiJobStatus[], cutoff: Date) => Promise<number>;
  deleteSuggestionsOlderThan: (cutoff: Date) => Promise<number>;
};

export type CleanupLineAiRetentionSummary = {
  deletedAuditLogs: number;
  deletedJobsCompletedOrSkipped: number;
  deletedJobsFailed: number;
  deletedSuggestions: number;
};

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

const defaultDeps: CleanupLineAiRetentionDeps = {
  deleteAuditLogsOlderThan,
  deleteJobsOlderThan,
  deleteSuggestionsOlderThan,
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

  return {
    deletedAuditLogs,
    deletedJobsCompletedOrSkipped,
    deletedJobsFailed,
    deletedSuggestions,
  };
}
