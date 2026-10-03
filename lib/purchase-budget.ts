import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import {
  computePurchaseBudgetFigures,
  parsePurchaseBudgetSettings,
  PURCHASE_BUDGET_SETTING_KEYS,
  type PurchaseBudgetFigures,
  type PurchaseBudgetFormView,
  type PurchaseBudgetSettings,
} from "@/lib/purchase-budget-core";
import { parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Server side of the purchase budget (lib/purchase-budget-core.ts has the formula): settings in
 * SiteContent and the totals the formula needs, read in ONE statement so a purchase save can take a
 * before/after snapshot cheaply.
 */

type SiteContentReader = Pick<Prisma.TransactionClient, "siteContent">;

export type PurchaseBudgetTotals = {
  stockValue: number;
  depositOutstanding: number;
  depositCount: number;
  nonTrackedPurchases: number;
  nonTrackedSales: number;
};

export type PurchaseBudgetSnapshot = {
  settings: PurchaseBudgetSettings & { cap: number };
  totals: PurchaseBudgetTotals;
  figures: PurchaseBudgetFigures;
};

export async function getPurchaseBudgetSettings(client: SiteContentReader = db): Promise<PurchaseBudgetSettings> {
  try {
    const rows = await client.siteContent.findMany({
      where: { key: { in: [...PURCHASE_BUDGET_SETTING_KEYS] } },
      select: { key: true, value: true },
    });
    return parsePurchaseBudgetSettings(rows);
  } catch (error) {
    throw new Error("Failed to read the purchase budget settings", { cause: error });
  }
}

/**
 * Stock value at cost (TRACKED products on hand, the same Σ stock × avgCost the stock report and
 * getCashHealth() use), open supplier deposits, and — from `startedAt` — non-tracked purchases (line
 * value + landed cost, i.e. their cost) and non-tracked cost of sales (the cost snapshot on each line).
 */
export async function loadPurchaseBudgetTotals(startedAt: Date | null): Promise<PurchaseBudgetTotals> {
  const nonTrackedPurchases = startedAt
    ? Prisma.sql`(SELECT COALESCE(SUM(pi."totalAmount" + pi."landedCost" * COALESCE(pi."showQty", pi."quantity")), 0)
        FROM "PurchaseItem" pi
        JOIN "Purchase" pu ON pu."id" = pi."purchaseId"
        JOIN "Product" pr ON pr."id" = pi."productId"
        WHERE pu."status" = 'ACTIVE' AND pr."inventoryTracking" = 'NON_TRACKED' AND pu."purchaseDate" >= ${startedAt})`
    : Prisma.sql`0`;
  const nonTrackedSales = startedAt
    ? Prisma.sql`(SELECT COALESCE(SUM(si."quantity" * si."costPrice"), 0)
        FROM "SaleItem" si
        JOIN "Sale" s ON s."id" = si."saleId"
        JOIN "Product" pr ON pr."id" = si."productId"
        WHERE s."status" = 'ACTIVE' AND pr."inventoryTracking" = 'NON_TRACKED' AND s."saleDate" >= ${startedAt})`
    : Prisma.sql`0`;

  try {
    const rows = await db.$queryRaw<PurchaseBudgetTotals[]>`
      SELECT
        (SELECT COALESCE(SUM(p."stock" * p."avgCost"), 0) FROM "Product" p
          WHERE p."stock" > 0 AND p."inventoryTracking" = 'TRACKED')::float8 AS "stockValue",
        (SELECT COALESCE(SUM(a."amountRemain"), 0) FROM "SupplierAdvance" a
          WHERE a."status" = 'ACTIVE' AND a."amountRemain" > 0)::float8 AS "depositOutstanding",
        (SELECT COUNT(*) FROM "SupplierAdvance" a
          WHERE a."status" = 'ACTIVE' AND a."amountRemain" > 0)::int AS "depositCount",
        ${nonTrackedPurchases}::float8 AS "nonTrackedPurchases",
        ${nonTrackedSales}::float8 AS "nonTrackedSales"
    `;
    const row = rows[0];
    return {
      stockValue: Number(row?.stockValue ?? 0),
      depositOutstanding: Number(row?.depositOutstanding ?? 0),
      depositCount: Number(row?.depositCount ?? 0),
      nonTrackedPurchases: Number(row?.nonTrackedPurchases ?? 0),
      nonTrackedSales: Number(row?.nonTrackedSales ?? 0),
    };
  } catch (error) {
    throw new Error("Failed to load the purchase budget totals", { cause: error });
  }
}

export function getPurchaseBudgetStartedAt(settings: PurchaseBudgetSettings): Date | null {
  return settings.startedOn ? parseDateOnlyToStartOfDay(settings.startedOn) : null;
}

export function buildPurchaseBudgetFigures(cap: number, thresholdPct: number, totals: PurchaseBudgetTotals): PurchaseBudgetFigures {
  return computePurchaseBudgetFigures({
    cap,
    thresholdPct,
    stockValue: totals.stockValue,
    depositOutstanding: totals.depositOutstanding,
    nonTrackedNet: totals.nonTrackedPurchases - totals.nonTrackedSales,
  });
}

/** The current budget, or null while no cap is set. */
export async function getPurchaseBudgetSnapshot(): Promise<PurchaseBudgetSnapshot | null> {
  const settings = await getPurchaseBudgetSettings();
  if (settings.cap === null) return null;
  const totals = await loadPurchaseBudgetTotals(getPurchaseBudgetStartedAt(settings));
  return {
    settings: { ...settings, cap: settings.cap },
    totals,
    figures: buildPurchaseBudgetFigures(settings.cap, settings.thresholdPct, totals),
  };
}

/**
 * What the purchase form's budget box needs. Never throws: a failed read hides the box and the
 * purchase page works exactly as before.
 */
export async function getPurchaseBudgetFormViewSafe(): Promise<PurchaseBudgetFormView | null> {
  try {
    const snapshot = await getPurchaseBudgetSnapshot();
    if (!snapshot) return null;
    return { cap: snapshot.figures.cap, remaining: snapshot.figures.remaining, thresholdPct: snapshot.figures.thresholdPct };
  } catch (error) {
    console.error("[purchase-budget] form view failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
