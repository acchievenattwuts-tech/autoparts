export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  cleanupExpiredPurchaseOcrFiles,
  PURCHASE_OCR_TEMP_MAX_AGE_MS,
} from "@/lib/purchase-invoice-storage";

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
    const summary = await cleanupExpiredPurchaseOcrFiles();
    return NextResponse.json({
      ok: true,
      maxAgeHours: PURCHASE_OCR_TEMP_MAX_AGE_MS / (60 * 60 * 1000),
      ...summary,
    });
  } catch (error) {
    console.error(
      "[purchase-ocr-cleanup] cron failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json({ ok: false, error: "PURCHASE_OCR_CLEANUP_FAILED" }, { status: 500 });
  }
}
