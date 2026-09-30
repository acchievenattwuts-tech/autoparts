import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDeliveryErrorLogCode } from "@/lib/line-delivery-transport";
import { processPendingSaleDeliveryLineDispatches } from "@/lib/line-delivery-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isAuthorized = (authorization: string | null): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice(7).trim());
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export const GET = async (request: Request): Promise<Response> => {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, processed: await processPendingSaleDeliveryLineDispatches() });
  } catch (error) {
    // Batch-level failure (the due-row query): there is no single dispatch id to log.
    console.error("[line-delivery] recovery failed", { code: getDeliveryErrorLogCode(error) });
    return NextResponse.json({ ok: false, error: "RECOVERY_FAILED" }, { status: 500 });
  }
};
