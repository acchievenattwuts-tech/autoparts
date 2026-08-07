export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportCriticalError } from "@/lib/error-reporting";

import { pullAllAuthorizedShops } from "@/lib/shopee/services/orders";

/**
 * Vercel Cron endpoint — scheduled order pull for every AUTHORIZED + syncEnabled
 * shop. Vercel attaches `Authorization: Bearer ${CRON_SECRET}` automatically.
 * Schedule is declared in `vercel.json`. NEVER creates Sales (Phase E queue only).
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
    const summary = await pullAllAuthorizedShops();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.shopee_pull_orders" });
    return NextResponse.json({ ok: false, error: "PULL_FAILED" }, { status: 500 });
  }
}
