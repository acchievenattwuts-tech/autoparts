export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { getMessengerConfig } from "@/lib/messenger/messenger-config";
import { recoverStalledMessengerConversations } from "@/lib/messenger/messenger-webhook-processor";

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

/**
 * Coalescing crash failsafe for Messenger: re-runs the owner loop for any
 * conversation left with unanswered messages after a webhook after() died. Safe
 * to run frequently — the per-conversation lock + quiet window prevent racing a
 * live owner or producing a duplicate reply.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const config = getMessengerConfig();
  if (!config.pageAccessToken) {
    return NextResponse.json({ ok: false, error: "MISSING_CONFIG", missing: config.missingEnv });
  }

  try {
    const { recovered } = await recoverStalledMessengerConversations({
      pageAccessToken: config.pageAccessToken,
    });
    if (recovered > 0) {
      console.warn(`[messenger-recover] re-ran owner loop for ${recovered} stalled conversation(s)`);
    }
    return NextResponse.json({ ok: true, recovered });
  } catch (error) {
    console.error(
      `[messenger-recover] failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return NextResponse.json({ ok: false, error: "RECOVER_FAILED" }, { status: 500 });
  }
}
