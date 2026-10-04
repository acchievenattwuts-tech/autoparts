import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { getVatRegisteredFrom } from "@/lib/input-vat";
import {
  computePurchaseBudgetFigures,
  parsePurchaseBudgetSettings,
  PURCHASE_BUDGET_SETTING_KEYS,
  type PurchaseBudgetEffects,
  type PurchaseBudgetFigures,
  type PurchaseBudgetFormView,
  type PurchaseBudgetSettings,
} from "@/lib/purchase-budget-core";
import { purchaseRowsSql, stockOtherRowsSql } from "@/lib/purchase-budget-sql";
import { getThailandDateKey, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Server side of the purchase budget (lib/purchase-budget-core.ts has the formula): settings in
 * SiteContent and what the documents dated from the start date did to it, read in ONE statement.
 */

type SiteContentReader = Pick<Prisma.TransactionClient, "siteContent">;

export type PurchaseBudgetSnapshot = {
  settings: PurchaseBudgetSettings & { budget: number; startedOn: string };
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

/** `vat_registered_from` as a Thailand date key, null while the shop is not VAT-registered. */
export async function getPurchaseBudgetRegisteredFromKey(): Promise<string | null> {
  const registeredFrom = await getVatRegisteredFrom(db);
  return registeredFrom ? getThailandDateKey(registeredFrom) : null;
}

/** Purchases, cost of sales and other stock moves of every document dated from `startedAt`. */
export async function loadPurchaseBudgetEffects(startedAt: Date, registeredFromKey: string | null): Promise<PurchaseBudgetEffects> {
  try {
    const rows = await db.$queryRaw<PurchaseBudgetEffects[]>`
      SELECT
        (SELECT COALESCE(SUM(pr."cost"), 0) FROM (${purchaseRowsSql(registeredFromKey, startedAt, null)}) pr)::float8 AS "purchases",
        (SELECT COALESCE(SUM(si."quantity" * si."costPrice"), 0)
           FROM "SaleItem" si
           JOIN "Sale" s ON s."id" = si."saleId"
          WHERE s."status" = 'ACTIVE' AND s."saleDate" >= ${startedAt})::float8 AS "salesCost",
        (SELECT COALESCE(-SUM(st."stockValue"), 0) FROM (${stockOtherRowsSql(startedAt, null)}) st)::float8 AS "otherEffect"
    `;
    const row = rows[0];
    return {
      purchases: Number(row?.purchases ?? 0),
      salesCost: Number(row?.salesCost ?? 0),
      otherEffect: Number(row?.otherEffect ?? 0),
    };
  } catch (error) {
    throw new Error("Failed to load the purchase budget effects", { cause: error });
  }
}

/** The current budget, or null while none is set. */
export async function getPurchaseBudgetSnapshot(): Promise<PurchaseBudgetSnapshot | null> {
  const settings = await getPurchaseBudgetSettings();
  if (settings.budget === null || settings.startedOn === null) return null;
  const registeredFromKey = await getPurchaseBudgetRegisteredFromKey();
  const effects = await loadPurchaseBudgetEffects(parseDateOnlyToStartOfDay(settings.startedOn), registeredFromKey);
  return {
    settings: { ...settings, budget: settings.budget, startedOn: settings.startedOn },
    figures: computePurchaseBudgetFigures(settings.budget, settings.thresholdPct, effects),
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
    return {
      budget: snapshot.figures.budget,
      remaining: snapshot.figures.remaining,
      thresholdPct: snapshot.figures.thresholdPct,
      startedOn: snapshot.settings.startedOn,
    };
  } catch (error) {
    console.error("[purchase-budget] form view failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
