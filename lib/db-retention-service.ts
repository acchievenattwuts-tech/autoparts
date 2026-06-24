import {
  ContentScheduledJobStatus,
  LineDailySummaryDispatchStatus,
  ShopeeSyncJobStatus,
} from "@/lib/generated/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

export const LOGIN_THROTTLE_RETENTION_DAYS = 30;
export const NOTIFICATION_RETENTION_DAYS = 30;
export const API_THROTTLE_RETENTION_DAYS = 7;
export const PRODUCT_SEARCH_LOG_RETENTION_DAYS = 180;
export const PRODUCT_SEARCH_CLUSTER_CACHE_RETENTION_DAYS = 7;
export const STOREFRONT_VISIT_DAILY_RETENTION_DAYS = 180;
export const SHOPEE_SYNC_JOB_RETENTION_DAYS = 180;
export const LINE_DAILY_SUMMARY_DISPATCH_RETENTION_DAYS = 180;
export const CONTENT_SCHEDULED_JOB_RETENTION_DAYS = 180;
export const CONTENT_AUDIT_LOG_RETENTION_DAYS = 180;

type CleanupDbRetentionDeps = {
  deleteLoginThrottlesOlderThan: (cutoff: Date) => Promise<number>;
  deleteReadNotificationsOlderThan: (cutoff: Date) => Promise<number>;
  deleteApiThrottlesOlderThan: (cutoff: Date) => Promise<number>;
  deleteProductSearchLogsOlderThan: (cutoff: Date) => Promise<number>;
  deleteProductSearchClusterCacheOlderThan: (cutoff: Date) => Promise<number>;
  deleteStorefrontVisitDailyOlderThan: (cutoff: Date) => Promise<number>;
  deleteShopeeSyncJobsOlderThan: (statuses: ShopeeSyncJobStatus[], cutoff: Date) => Promise<number>;
  deleteLineDailySummaryDispatchesOlderThan: (
    statuses: LineDailySummaryDispatchStatus[],
    cutoff: Date,
  ) => Promise<number>;
  deleteContentScheduledJobsOlderThan: (
    statuses: ContentScheduledJobStatus[],
    cutoff: Date,
  ) => Promise<number>;
  deleteContentAuditLogsOlderThan: (cutoff: Date) => Promise<number>;
};

export type CleanupDbRetentionSummary = {
  deletedLoginThrottles: number;
  deletedReadNotifications: number;
  deletedApiThrottles: number;
  deletedProductSearchLogs: number;
  deletedProductSearchClusterCaches: number;
  deletedStorefrontVisitDailies: number;
  deletedShopeeSyncJobs: number;
  deletedLineDailySummaryDispatches: number;
  deletedContentScheduledJobs: number;
  deletedContentAuditLogs: number;
};

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

async function deleteLoginThrottlesOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.loginThrottle.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteReadNotificationsOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.notification.deleteMany({
    where: {
      readAt: { not: null },
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteApiThrottlesOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.apiThrottle.deleteMany({
    where: {
      windowEnd: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteProductSearchLogsOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.productSearchLog.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteProductSearchClusterCacheOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.productSearchClusterCache.deleteMany({
    where: {
      computedAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteStorefrontVisitDailyOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.storefrontVisitDaily.deleteMany({
    where: {
      lastSeenAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteShopeeSyncJobsOlderThan(
  statuses: ShopeeSyncJobStatus[],
  cutoff: Date,
): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.shopeeSyncJob.deleteMany({
    where: {
      status: { in: statuses },
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteLineDailySummaryDispatchesOlderThan(
  statuses: LineDailySummaryDispatchStatus[],
  cutoff: Date,
): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.lineDailySummaryDispatch.deleteMany({
    where: {
      status: { in: statuses },
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteContentScheduledJobsOlderThan(
  statuses: ContentScheduledJobStatus[],
  cutoff: Date,
): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.contentScheduledJob.deleteMany({
    where: {
      status: { in: statuses },
      updatedAt: { lt: cutoff },
    },
  });
  return result.count;
}

async function deleteContentAuditLogsOlderThan(cutoff: Date): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.contentAuditLog.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}

const defaultDeps: CleanupDbRetentionDeps = {
  deleteLoginThrottlesOlderThan,
  deleteReadNotificationsOlderThan,
  deleteApiThrottlesOlderThan,
  deleteProductSearchLogsOlderThan,
  deleteProductSearchClusterCacheOlderThan,
  deleteStorefrontVisitDailyOlderThan,
  deleteShopeeSyncJobsOlderThan,
  deleteLineDailySummaryDispatchesOlderThan,
  deleteContentScheduledJobsOlderThan,
  deleteContentAuditLogsOlderThan,
};

export async function cleanupDbRetention(
  input: Partial<CleanupDbRetentionDeps> & { now?: Date } = {},
): Promise<CleanupDbRetentionSummary> {
  const now = input.now ?? new Date();
  const deps = { ...defaultDeps, ...input };

  const loginCutoff = daysAgo(now, LOGIN_THROTTLE_RETENTION_DAYS);
  const notificationCutoff = daysAgo(now, NOTIFICATION_RETENTION_DAYS);
  const apiThrottleCutoff = daysAgo(now, API_THROTTLE_RETENTION_DAYS);
  const productSearchLogCutoff = daysAgo(now, PRODUCT_SEARCH_LOG_RETENTION_DAYS);
  const productSearchClusterCacheCutoff = daysAgo(now, PRODUCT_SEARCH_CLUSTER_CACHE_RETENTION_DAYS);
  const storefrontVisitDailyCutoff = daysAgo(now, STOREFRONT_VISIT_DAILY_RETENTION_DAYS);
  const shopeeSyncJobCutoff = daysAgo(now, SHOPEE_SYNC_JOB_RETENTION_DAYS);
  const lineDailySummaryCutoff = daysAgo(now, LINE_DAILY_SUMMARY_DISPATCH_RETENTION_DAYS);
  const contentScheduledJobCutoff = daysAgo(now, CONTENT_SCHEDULED_JOB_RETENTION_DAYS);
  const contentAuditLogCutoff = daysAgo(now, CONTENT_AUDIT_LOG_RETENTION_DAYS);

  const deletedLoginThrottles = await deps.deleteLoginThrottlesOlderThan(loginCutoff);
  const deletedReadNotifications = await deps.deleteReadNotificationsOlderThan(notificationCutoff);
  const deletedApiThrottles = await deps.deleteApiThrottlesOlderThan(apiThrottleCutoff);
  const deletedProductSearchLogs = await deps.deleteProductSearchLogsOlderThan(productSearchLogCutoff);
  const deletedProductSearchClusterCaches = await deps.deleteProductSearchClusterCacheOlderThan(
    productSearchClusterCacheCutoff,
  );
  const deletedStorefrontVisitDailies = await deps.deleteStorefrontVisitDailyOlderThan(
    storefrontVisitDailyCutoff,
  );
  const deletedShopeeSyncJobs = await deps.deleteShopeeSyncJobsOlderThan(
    [ShopeeSyncJobStatus.SUCCESS, ShopeeSyncJobStatus.FAILED],
    shopeeSyncJobCutoff,
  );
  const deletedLineDailySummaryDispatches = await deps.deleteLineDailySummaryDispatchesOlderThan(
    [
      LineDailySummaryDispatchStatus.SENT,
      LineDailySummaryDispatchStatus.FAILED,
      LineDailySummaryDispatchStatus.SKIPPED,
    ],
    lineDailySummaryCutoff,
  );
  const deletedContentScheduledJobs = await deps.deleteContentScheduledJobsOlderThan(
    [
      ContentScheduledJobStatus.SUCCEEDED,
      ContentScheduledJobStatus.FAILED,
      ContentScheduledJobStatus.CANCELLED,
    ],
    contentScheduledJobCutoff,
  );
  const deletedContentAuditLogs = await deps.deleteContentAuditLogsOlderThan(contentAuditLogCutoff);

  return {
    deletedLoginThrottles,
    deletedReadNotifications,
    deletedApiThrottles,
    deletedProductSearchLogs,
    deletedProductSearchClusterCaches,
    deletedStorefrontVisitDailies,
    deletedShopeeSyncJobs,
    deletedLineDailySummaryDispatches,
    deletedContentScheduledJobs,
    deletedContentAuditLogs,
  };
}
