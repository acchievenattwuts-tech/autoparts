export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { cleanupOldNotifications } from "@/lib/notifications";

/**
 * Deletes read notifications older than the retention window.
 *
 * Replaces a `node-cron` timer that instrumentation.ts registered at server
 * startup. That never actually ran on Vercel: serverless instances are frozen
 * between requests and recycled constantly, so a timer scheduled hours ahead
 * almost never survives to fire — and node-cron reads the server timezone
 * (UTC), so the "2 AM Bangkok" it claimed would have been 9 AM Bangkok anyway.
 * The Notification table therefore grew unbounded from the day that job landed.
 *
 * Vercel Cron triggers this with a GET and attaches
 * `Authorization: Bearer ${CRON_SECRET}`; the schedule lives in vercel.json.
 *
 * Only rows that are BOTH already read AND past the window are removed, so an
 * unread alert is never deleted no matter how old it is.
 */

const RETENTION_DAYS = 30;

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
    const deleted = await cleanupOldNotifications(RETENTION_DAYS);
    if (deleted > 0) {
      console.log(`[notification-cleanup] deleted ${deleted} read notifications`);
    }
    return NextResponse.json({ ok: true, retentionDays: RETENTION_DAYS, deleted });
  } catch (error) {
    console.error(
      "[notification-cleanup] cron failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json({ ok: false, error: "NOTIFICATION_CLEANUP_FAILED" }, { status: 500 });
  }
}
