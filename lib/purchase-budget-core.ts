import { allocatePurchaseLandedCost, type PurchaseInventoryCostInput } from "@/lib/purchase-inventory-cost";
import { isDateOnlyString } from "@/lib/th-date";

/**
 * Purchase budget (owner decisions 2026-10-03, revised 2026-10-04) — a running purchase budget that
 * starts on the day it is set. Only documents dated from that day count; stock bought earlier is not
 * charged to it.
 *
 *   remaining = budget set (incl. later top-ups and cuts)
 *               − purchases (the value each puts into stock, cash or credit alike)
 *               + cost of goods sold (every sale, old stock included — never the selling price)
 *               ± other stock moves at cost (customer and supplier returns, debit notes, purchase
 *                 allowances, adjustments, claims; balance-forward entries excluded)
 *
 * Supplier deposits never touch it: they are listed for information and the purchase that receives
 * the goods uses the budget. Cancelling or editing a counted document re-derives every figure; only
 * the budget amount, its start date and the warning line are stored.
 *
 * Pure module: safe for client components (purchase form) and unit tests.
 */

/** Historical key name: holds the budget amount set (start amount ± top-ups and cuts). */
export const PURCHASE_BUDGET_CAP_KEY = "purchase_budget_cap";
export const PURCHASE_BUDGET_THRESHOLD_KEY = "purchase_budget_threshold_pct";
/** Thailand date (YYYY-MM-DD) documents count from. */
export const PURCHASE_BUDGET_STARTED_ON_KEY = "purchase_budget_started_on";
export const PURCHASE_BUDGET_SETTING_KEYS = [
  PURCHASE_BUDGET_CAP_KEY,
  PURCHASE_BUDGET_THRESHOLD_KEY,
  PURCHASE_BUDGET_STARTED_ON_KEY,
] as const;
/** Level ("ok" | "low" | "over") the last alert check saw — an alert fires only when the level gets worse. */
export const PURCHASE_BUDGET_ALERT_LEVEL_KEY = "purchase_budget_alert_level";
export const PURCHASE_BUDGET_AUDIT_ENTITY = "PurchaseBudget";
export const PURCHASE_BUDGET_LINK = "/admin/dashboard?tab=budget";

export const PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT = 10;
export const PURCHASE_BUDGET_MAX_THRESHOLD_PCT = 50;
/** Largest budget the form accepts (Decimal(10,2)-sized money, like every other amount in the shop). */
export const PURCHASE_BUDGET_MAX_AMOUNT = 99_999_999.99;

const SATANG_PER_BAHT = 100;
const PERCENT = 100;

export type PurchaseBudgetLevel = "ok" | "low" | "over";

const LEVEL_RANK: Record<PurchaseBudgetLevel, number> = { ok: 0, low: 1, over: 2 };

export type PurchaseBudgetSettings = {
  budget: number | null;
  thresholdPct: number;
  startedOn: string | null;
};

/** What the counted documents did to the budget since the start date (all amounts positive except `otherEffect`). */
export type PurchaseBudgetEffects = {
  purchases: number;
  salesCost: number;
  /** Signed budget effect of the other stock moves: + gives budget back, − uses it. */
  otherEffect: number;
};

export type PurchaseBudgetFigures = PurchaseBudgetEffects & {
  budget: number;
  thresholdPct: number;
  /** budget − remaining: net budget used since the start (negative when sales gave back more). */
  used: number;
  remaining: number;
  remainingPct: number;
  level: PurchaseBudgetLevel;
};

/** "restart" = a new budget amount counted from a new start date (the first setup is one too). */
export type PurchaseBudgetChangeMode = "add" | "subtract" | "restart";

export function roundBaht(value: number): number {
  return Math.round((value + Number.EPSILON) * SATANG_PER_BAHT) / SATANG_PER_BAHT;
}

function parseFiniteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** SiteContent rows → settings. A missing or malformed amount or start date means not set up yet. */
export function parsePurchaseBudgetSettings(rows: readonly { key: string; value: string }[]): PurchaseBudgetSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const budget = parseFiniteNumber(byKey.get(PURCHASE_BUDGET_CAP_KEY));
  const threshold = parseFiniteNumber(byKey.get(PURCHASE_BUDGET_THRESHOLD_KEY));
  const startedOn = byKey.get(PURCHASE_BUDGET_STARTED_ON_KEY)?.trim() ?? "";
  const validStart = isDateOnlyString(startedOn) ? startedOn : null;
  return {
    budget: budget !== null && budget >= 0 && validStart ? roundBaht(budget) : null,
    thresholdPct:
      threshold !== null && threshold >= 0 && threshold <= PURCHASE_BUDGET_MAX_THRESHOLD_PCT
        ? threshold
        : PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT,
    startedOn: validStart,
  };
}

export function resolvePurchaseBudgetLevel(remaining: number, budget: number, thresholdPct: number): PurchaseBudgetLevel {
  if (remaining < 0) return "over";
  if (budget <= 0) return "low";
  return (remaining / budget) * PERCENT < thresholdPct ? "low" : "ok";
}

export function computePurchaseBudgetFigures(
  budget: number,
  thresholdPct: number,
  effects: PurchaseBudgetEffects,
): PurchaseBudgetFigures {
  const remaining = roundBaht(budget - effects.purchases + effects.salesCost + effects.otherEffect);
  return {
    purchases: roundBaht(effects.purchases),
    salesCost: roundBaht(effects.salesCost),
    otherEffect: roundBaht(effects.otherEffect),
    budget,
    thresholdPct,
    used: roundBaht(budget - remaining),
    remaining,
    remainingPct: budget > 0 ? (remaining / budget) * PERCENT : 0,
    level: resolvePurchaseBudgetLevel(remaining, budget, thresholdPct),
  };
}

/** True when `after` is a worse state than `before` (ok → low → over) — the only moves that alert. */
export function isPurchaseBudgetLevelWorse(before: PurchaseBudgetLevel, after: PurchaseBudgetLevel): boolean {
  return LEVEL_RANK[after] > LEVEL_RANK[before];
}

/** New budget amount after a change: top-up, cut (never below 0) or a restart with a new amount. */
export function applyPurchaseBudgetChange(current: number | null, mode: PurchaseBudgetChangeMode, amount: number): number {
  const base = current ?? 0;
  if (mode === "add") return roundBaht(base + amount);
  if (mode === "subtract") return roundBaht(Math.max(0, base - amount));
  return roundBaht(amount);
}

/**
 * Budget a purchase uses: Σ line values + the landed-cost spread, i.e. exactly the cost the purchase
 * puts into stock (recoverable VAT excluded, shipping included, header discount deducted). Equals the
 * header's pre-VAT amount when its VAT is recoverable, else its net amount.
 */
export function computePurchaseBudgetUsage(input: PurchaseInventoryCostInput): number {
  const lineTotal = input.lines.reduce((sum, line) => sum + line.qty * line.costPrice, 0);
  const landedTotal = allocatePurchaseLandedCost(input).reduce((sum, amount) => sum + amount, 0);
  return roundBaht(lineTotal + landedTotal);
}

export type PurchaseBudgetFormView = {
  budget: number;
  remaining: number;
  thresholdPct: number;
  /** Thailand date key the budget counts documents from. */
  startedOn: string;
};

/** A document uses (or gives back) budget only when it is dated on or after the start date. */
export function isCountedInPurchaseBudget(documentDateKey: string, startedOn: string): boolean {
  return isDateOnlyString(documentDateKey) && documentDateKey >= startedOn;
}

export type PurchaseBudgetPreview = {
  remainingBefore: number;
  usage: number;
  remainingAfter: number;
  remainingAfterPct: number;
  levelAfter: PurchaseBudgetLevel;
};

/** What saving the form would leave: `usage` is the change against what is already saved (0 for nothing). */
export function previewPurchaseBudget(view: PurchaseBudgetFormView, remainingBefore: number, usage: number): PurchaseBudgetPreview {
  const remainingAfter = roundBaht(remainingBefore - usage);
  return {
    remainingBefore: roundBaht(remainingBefore),
    usage: roundBaht(usage),
    remainingAfter,
    remainingAfterPct: view.budget > 0 ? (remainingAfter / view.budget) * PERCENT : 0,
    levelAfter: resolvePurchaseBudgetLevel(remainingAfter, view.budget, view.thresholdPct),
  };
}
