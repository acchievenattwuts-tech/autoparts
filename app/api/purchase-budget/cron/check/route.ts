export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportCriticalError } from "@/lib/error-reporting";
import { checkPurchaseBudgetAlert } from "@/lib/purchase-budget-alerts";

/**
 * Vercel Cron endpoint for the purchase budget alert (lib/purchase-budget-alerts.ts): reads the
 * budget and sends bell + Telegram when it moved below the warning line or past the cap since the
 * previous run. Purely a reader of business data — no purchase, sale or stock flow calls it.
 *
 * Vercel Cron triggers this with a GET and attaches `Authorization: Bearer ${CRON_SECRET}`; the
 * schedule lives in vercel.json: hourly at :05 during shop hours, 08:05–20:05 Thailand
 * (01:05–13:05 UTC, owner choice 2026-10-03). A cap change still checks at once.
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
    const result = await checkPurchaseBudgetAlert();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.purchase_budget_alert" });
    return NextResponse.json({ ok: false, error: "PURCHASE_BUDGET_ALERT_FAILED" }, { status: 500 });
  }
}
