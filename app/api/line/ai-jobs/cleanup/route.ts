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
    const summary = await cleanupLineAiRetention();
    return NextResponse.json({
      ok: true,
      retentionDays: {
        auditLogs: LINE_AI_AUDIT_RETENTION_DAYS,
        completedOrSkippedJobs: LINE_AI_JOB_COMPLETED_OR_SKIPPED_RETENTION_DAYS,
        failedJobs: LINE_AI_JOB_FAILED_RETENTION_DAYS,
        suggestions: LINE_AI_SUGGESTION_RETENTION_DAYS,
      },
      ...summary,
    });
  } catch (error) {
    console.error("[line-ai-cleanup] cron failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "LINE_AI_CLEANUP_FAILED" }, { status: 500 });
  }
}
