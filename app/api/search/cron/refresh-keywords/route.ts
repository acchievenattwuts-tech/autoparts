export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportCriticalError } from "@/lib/error-reporting";

import { refreshSearchKeywordIndex } from "@/lib/search-keyword-index";

/**
 * Vercel Cron endpoint that rebuilds the SearchKeyword index powering the
 * keyword-first autocomplete dropdown. Triggered by Vercel Cron with
 * `Authorization: Bearer ${CRON_SECRET}`; schedule declared in vercel.json.
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
    const rows = await refreshSearchKeywordIndex();
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.search_keywords" });
    return NextResponse.json({ ok: false, error: "REFRESH_FAILED" }, { status: 500 });
  }
}
