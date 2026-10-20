export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { writeAuditLogManyTx, type AuditLogActor } from "@/lib/audit-log";
import { dbTx } from "@/lib/db";
import { reportCriticalError } from "@/lib/error-reporting";
import {
  buildShelfLocationAuditInput,
  loadProductShelfLocationViews,
  removeSecondaryLocationsOfOutOfStockProducts,
  type SecondaryCleanupRow,
  type ShelfLocationView,
} from "@/lib/shelf-map";
import { describeShelfLocationRows } from "@/lib/shelf-product-form";

/**
 * Vercel Cron endpoint for the shelf map (Q11, approved 2026-10-19): once a tracked,
 * active product's total stock is at or below zero, nothing can still sit in its overflow
 * locations (ที่เก็บเพิ่ม), so they are removed. The home location (ที่เก็บประจำ) is always
 * kept for the next receipt. One audit entry per product, in the same transaction.
 *
 * Vercel Cron triggers this with a GET request and attaches
 * `Authorization: Bearer ${CRON_SECRET}`. The schedule (02:15 Thailand = 19:15 UTC, after
 * the 18:30 out-of-stock digest) is declared in `vercel.json`.
 */

/** Unattended job: no user. The audit log shows a null user as "ระบบ", like other system entries. */
const CRON_ACTOR: AuditLogActor = { userId: null, userName: null, userRole: null };

/** Same label describeShelfLocations() gives an overflow location ("Z-1 (เพิ่ม)"). */
const describeRemovedSecondary = (code: string): string => `${code} (เพิ่ม)`;

const describeViews = (views: readonly ShelfLocationView[]): string[] =>
  describeShelfLocationRows(views.map((view) => ({ ...view, rack: { code: view.rackCode } })));

type CleanupSummary = { products: number; removed: number };

const runSecondaryCleanup = (): Promise<CleanupSummary> =>
  dbTx(async (tx): Promise<CleanupSummary> => {
    const rows: SecondaryCleanupRow[] = await removeSecondaryLocationsOfOutOfStockProducts(tx);
    if (rows.length === 0) return { products: 0, removed: 0 };

    const remaining = await loadProductShelfLocationViews(
      tx,
      rows.map((row) => row.productId),
    );
    await writeAuditLogManyTx(
      tx,
      rows.map((row) => {
        const after = describeViews(remaining.get(row.productId) ?? []);
        return buildShelfLocationAuditInput({
          actor: CRON_ACTOR,
          productId: row.productId,
          productCode: row.productCode,
          before: [...after, ...row.removed.map(describeRemovedSecondary)],
          after,
          changed: true,
          source: "shelf_secondary_cleanup",
          meta: { trigger: "cron", removed: row.removed },
        });
      }),
    );
    return { products: rows.length, removed: rows.reduce((sum, row) => sum + row.removed.length, 0) };
  });

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
    const summary = await runSecondaryCleanup();
    if (summary.removed > 0) {
      console.log(`[shelf-secondary-cleanup] removed ${summary.removed} overflow locations of ${summary.products} products`);
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    await reportCriticalError(error, { scope: "cron.shelf_secondary_cleanup" });
    return NextResponse.json({ ok: false, error: "SHELF_CLEANUP_FAILED" }, { status: 500 });
  }
}
