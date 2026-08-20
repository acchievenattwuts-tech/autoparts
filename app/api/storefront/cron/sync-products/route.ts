export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reportCriticalError } from "@/lib/error-reporting";
import { processStorefrontSyncQueue } from "@/lib/storefront-sync";

function isAuthorized(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(secret);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const result = await processStorefrontSyncQueue();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.storefront_product_sync" });
    return NextResponse.json({ ok: false, error: "STOREFRONT_SYNC_FAILED" }, { status: 500 });
  }
}
