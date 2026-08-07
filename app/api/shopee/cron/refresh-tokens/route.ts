export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportCriticalError } from "@/lib/error-reporting";

import { refreshExpiringShopTokens } from "@/lib/shopee/services/token-maintenance";

/**
 * Vercel Cron endpoint that proactively refreshes Shopee tokens nearing expiry.
 *
 * Vercel Cron triggers this with a GET request and automatically attaches
 * `Authorization: Bearer ${CRON_SECRET}` (when the CRON_SECRET env var is set).
 * The schedule itself is declared in `vercel.json`.
 *
 * Note: `getValidShopAuth()` already refreshes on demand before any API call, so
 * this is a reliability/alerting layer — not strictly required for correctness.
 */

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
    const result = await refreshExpiringShopTokens();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.shopee_refresh_tokens" });
    return NextResponse.json({ ok: false, error: "REFRESH_FAILED" }, { status: 500 });
  }
}
