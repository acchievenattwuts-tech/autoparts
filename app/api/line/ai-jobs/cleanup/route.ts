export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  cleanupLineAiRetention,
  LINE_AI_AUDIT_RETENTION_DAYS,
  LINE_AI_JOB_COMPLETED_OR_SKIPPED_RETENTION_DAYS,
  LINE_AI_JOB_FAILED_RETENTION_DAYS,
  LINE_AI_SUGGESTION_RETENTION_DAYS,
} from "@/lib/line-ai-retention-service";
import {
  API_THROTTLE_RETENTION_DAYS,
  cleanupDbRetention,
  CONTENT_AUDIT_LOG_RETENTION_DAYS,
  CONTENT_SCHEDULED_JOB_RETENTION_DAYS,
  LINE_DAILY_SUMMARY_DISPATCH_RETENTION_DAYS,
  LOGIN_THROTTLE_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
  PRODUCT_SEARCH_CLUSTER_CACHE_RETENTION_DAYS,
  PRODUCT_SEARCH_LOG_RETENTION_DAYS,
  SHOPEE_SYNC_JOB_RETENTION_DAYS,
  STOREFRONT_VISIT_DAILY_RETENTION_DAYS,
} from "@/lib/db-retention-service";

const isAuthorized = (authHeader: string | null): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!provided) return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(secret);
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const [lineAiSummary, dbSummary] = await Promise.all([
      cleanupLineAiRetention(),
      cleanupDbRetention(),
    ]);

    return NextResponse.json({
      ok: true,
      retentionDays: {
        lineAi: {
          auditLogs: LINE_AI_AUDIT_RETENTION_DAYS,
          completedOrSkippedJobs: LINE_AI_JOB_COMPLETED_OR_SKIPPED_RETENTION_DAYS,
          failedJobs: LINE_AI_JOB_FAILED_RETENTION_DAYS,
          suggestions: LINE_AI_SUGGESTION_RETENTION_DAYS,
        },
        db: {
          loginThrottles: LOGIN_THROTTLE_RETENTION_DAYS,
          readNotifications: NOTIFICATION_RETENTION_DAYS,
          apiThrottles: API_THROTTLE_RETENTION_DAYS,
          productSearchLogs: PRODUCT_SEARCH_LOG_RETENTION_DAYS,
          productSearchClusterCaches: PRODUCT_SEARCH_CLUSTER_CACHE_RETENTION_DAYS,
          storefrontVisitDailies: STOREFRONT_VISIT_DAILY_RETENTION_DAYS,
          shopeeSyncJobs: SHOPEE_SYNC_JOB_RETENTION_DAYS,
          lineDailySummaryDispatches: LINE_DAILY_SUMMARY_DISPATCH_RETENTION_DAYS,
          contentScheduledJobs: CONTENT_SCHEDULED_JOB_RETENTION_DAYS,
          contentAuditLogs: CONTENT_AUDIT_LOG_RETENTION_DAYS,
        },
      },
      lineAi: lineAiSummary,
      db: dbSummary,
    });
  } catch (error) {
    console.error("[line-ai-cleanup] cron failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "LINE_AI_CLEANUP_FAILED" }, { status: 500 });
  }
}
