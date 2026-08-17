export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { reportCriticalError } from "@/lib/error-reporting";

import { db } from "@/lib/db";
import { notifyOutOfStockDaily, type OutOfStockProduct } from "@/lib/notifications";
import { buildOutOfStockProductsWhere } from "@/lib/out-of-stock-products";

/**
 * Vercel Cron endpoint that sends the daily out-of-stock digest to admins
 * (in-app bell + Telegram) so the shop can reorder. Lists every ACTIVE product
 * whose stock is at or below zero, grouped by category (design A).
 *
 * When nothing is out of stock it still sends an "all clear" heartbeat, so a
 * quiet evening is distinguishable from a cron that silently stopped firing.
 *
 * Vercel Cron triggers this with a GET request and automatically attaches
 * `Authorization: Bearer ${CRON_SECRET}` (when the CRON_SECRET env var is set).
 * The schedule (18:30 Thailand = 11:30 UTC) is declared in `vercel.json`.
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
    const rows = await db.product.findMany({
      where: buildOutOfStockProductsWhere(),
      select: { code: true, name: true, category: { select: { name: true } } },
      orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
    });

    const products: OutOfStockProduct[] = rows.map((row) => ({
      code: row.code,
      name: row.name,
      categoryName: row.category.name,
    }));

    const notified = await notifyOutOfStockDaily(products);
    return NextResponse.json({ ok: true, outOfStockCount: products.length, notified });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.out_of_stock_alert" });
    return NextResponse.json({ ok: false, error: "ALERT_FAILED" }, { status: 500 });
  }
}
