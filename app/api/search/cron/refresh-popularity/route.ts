export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportCriticalError } from "@/lib/error-reporting";

import { refreshSearchPopularity, POPULARITY_WINDOW_DAYS } from "@/lib/search-popularity";

/**
 * Vercel Cron endpoint that recomputes the rolling 90-day popularity signal
 * (product_search_documents.sales_count) used by the search ranking boost.
 *
 * Vercel Cron triggers this with a GET request and automatically attaches
 * `Authorization: Bearer ${CRON_SECRET}` (when the CRON_SECRET env var is set).
 * The schedule itself is declared in `vercel.json`.
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
    const { rowsUpdated } = await refreshSearchPopularity();
    return NextResponse.json({ ok: true, windowDays: POPULARITY_WINDOW_DAYS, rowsUpdated });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.search_popularity" });
    return NextResponse.json({ ok: false, error: "REFRESH_FAILED" }, { status: 500 });
  }
}
