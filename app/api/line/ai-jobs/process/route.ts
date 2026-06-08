export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { processPendingLineAiJobs } from "@/lib/line-ai-job-worker";
import { getLineDailySummaryConfig } from "@/lib/line-messaging";

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
    const config = getLineDailySummaryConfig();
    const summary = await processPendingLineAiJobs({
      channelAccessToken: config.channelAccessToken,
      take: 10,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[line-ai-job-worker] cron failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "LINE_AI_JOB_PROCESS_FAILED" }, { status: 500 });
  }
}
