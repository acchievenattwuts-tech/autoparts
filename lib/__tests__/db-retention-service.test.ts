import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupDbRetention,
  API_THROTTLE_RETENTION_DAYS,
  CONTENT_AUDIT_LOG_RETENTION_DAYS,
  CONTENT_SCHEDULED_JOB_RETENTION_DAYS,
  LINE_DAILY_SUMMARY_DISPATCH_RETENTION_DAYS,
  LOGIN_THROTTLE_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
  PRODUCT_SEARCH_CLUSTER_CACHE_RETENTION_DAYS,
  PRODUCT_SEARCH_LOG_RETENTION_DAYS,
  SHOPEE_SYNC_JOB_RETENTION_DAYS,
  STOREFRONT_VISIT_DAILY_RETENTION_DAYS,
} from "../db-retention-service";
import {
  ContentScheduledJobStatus,
  LineDailySummaryDispatchStatus,
  ShopeeSyncJobStatus,
} from "../generated/prisma";

test("cleanupDbRetention applies the configured retention windows per table and status", async () => {
  const now = new Date("2026-06-24T00:00:00.000Z");
  const calls: Array<{ kind: string; cutoff: Date; statuses?: string[] }> = [];

  const summary = await cleanupDbRetention({
    now,
    deleteLoginThrottlesOlderThan: async (cutoff) => {
      calls.push({ kind: "login", cutoff });
      return 1;
    },
    deleteReadNotificationsOlderThan: async (cutoff) => {
      calls.push({ kind: "notification", cutoff });
      return 10;
    },
    deleteApiThrottlesOlderThan: async (cutoff) => {
      calls.push({ kind: "api", cutoff });
      return 2;
    },
    deleteProductSearchLogsOlderThan: async (cutoff) => {
      calls.push({ kind: "search-log", cutoff });
      return 3;
    },
    deleteProductSearchClusterCacheOlderThan: async (cutoff) => {
      calls.push({ kind: "search-cache", cutoff });
      return 4;
    },
    deleteStorefrontVisitDailyOlderThan: async (cutoff) => {
      calls.push({ kind: "visit", cutoff });
      return 5;
    },
    deleteShopeeSyncJobsOlderThan: async (statuses, cutoff) => {
      calls.push({ kind: "shopee-job", statuses, cutoff });
      return 6;
    },
    deleteLineDailySummaryDispatchesOlderThan: async (statuses, cutoff) => {
      calls.push({ kind: "line-summary", statuses, cutoff });
      return 7;
    },
    deleteContentScheduledJobsOlderThan: async (statuses, cutoff) => {
      calls.push({ kind: "content-job", statuses, cutoff });
      return 8;
    },
    deleteContentAuditLogsOlderThan: async (cutoff) => {
      calls.push({ kind: "content-audit", cutoff });
      return 9;
    },
  });

  assert.deepEqual(calls, [
    { kind: "login", cutoff: new Date("2026-05-25T00:00:00.000Z") },
    { kind: "notification", cutoff: new Date("2026-05-25T00:00:00.000Z") },
    { kind: "api", cutoff: new Date("2026-06-17T00:00:00.000Z") },
    { kind: "search-log", cutoff: new Date("2025-12-26T00:00:00.000Z") },
    { kind: "search-cache", cutoff: new Date("2026-06-17T00:00:00.000Z") },
    { kind: "visit", cutoff: new Date("2025-12-26T00:00:00.000Z") },
    {
      kind: "shopee-job",
      statuses: [ShopeeSyncJobStatus.SUCCESS, ShopeeSyncJobStatus.FAILED],
      cutoff: new Date("2025-12-26T00:00:00.000Z"),
    },
    {
      kind: "line-summary",
      statuses: [
        LineDailySummaryDispatchStatus.SENT,
        LineDailySummaryDispatchStatus.FAILED,
        LineDailySummaryDispatchStatus.SKIPPED,
      ],
      cutoff: new Date("2025-12-26T00:00:00.000Z"),
    },
    {
      kind: "content-job",
      statuses: [
        ContentScheduledJobStatus.SUCCEEDED,
        ContentScheduledJobStatus.FAILED,
        ContentScheduledJobStatus.CANCELLED,
      ],
      cutoff: new Date("2025-12-26T00:00:00.000Z"),
    },
    { kind: "content-audit", cutoff: new Date("2025-12-26T00:00:00.000Z") },
  ]);

  assert.deepEqual(summary, {
    deletedLoginThrottles: 1,
    deletedReadNotifications: 10,
    deletedApiThrottles: 2,
    deletedProductSearchLogs: 3,
    deletedProductSearchClusterCaches: 4,
    deletedStorefrontVisitDailies: 5,
    deletedShopeeSyncJobs: 6,
    deletedLineDailySummaryDispatches: 7,
    deletedContentScheduledJobs: 8,
    deletedContentAuditLogs: 9,
  });
});

test("retention windows stay aligned with the approved policy", () => {
  assert.equal(LOGIN_THROTTLE_RETENTION_DAYS, 30);
  assert.equal(NOTIFICATION_RETENTION_DAYS, 30);
  assert.equal(API_THROTTLE_RETENTION_DAYS, 7);
  assert.equal(PRODUCT_SEARCH_LOG_RETENTION_DAYS, 180);
  assert.equal(PRODUCT_SEARCH_CLUSTER_CACHE_RETENTION_DAYS, 7);
  assert.equal(STOREFRONT_VISIT_DAILY_RETENTION_DAYS, 180);
  assert.equal(SHOPEE_SYNC_JOB_RETENTION_DAYS, 180);
  assert.equal(LINE_DAILY_SUMMARY_DISPATCH_RETENTION_DAYS, 180);
  assert.equal(CONTENT_SCHEDULED_JOB_RETENTION_DAYS, 180);
  assert.equal(CONTENT_AUDIT_LOG_RETENTION_DAYS, 180);
});
