import { allocatePurchaseLandedCost, type PurchaseInventoryCostInput } from "@/lib/purchase-inventory-cost";
import { isDateOnlyString } from "@/lib/th-date";

/**
 * Purchase budget (owner decision 2026-10-03) — an Open-to-Buy figure kept at cost.
 *
 *   remaining = cap − stock value at cost − supplier deposits still awaiting goods
 *               − non-tracked purchases net of their cost of sales (since the budget started)
 *
 * A purchase (cash or credit) uses the budget by the value it puts into stock; a sale gives back the
 * cost of the goods sold, never the selling price. Returns, adjustments, claims, debit notes,
 * cancellations and edits move it through the stock value the stock card already recalculates, so no
 * budget ledger exists — every figure is derived from data the system already keeps.
 *
 * Pure module: safe for client components (purchase form) and unit tests.
 */

export const PURCHASE_BUDGET_CAP_KEY = "purchase_budget_cap";
export const PURCHASE_BUDGET_THRESHOLD_KEY = "purchase_budget_threshold_pct";
/** Thailand date (YYYY-MM-DD) the cap was first set — non-tracked purchases/sales count from it. */
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
/** Largest cap the form accepts (Decimal(10,2)-sized money, like every other amount in the shop). */
export const PURCHASE_BUDGET_MAX_CAP = 99_999_999.99;

const SATANG_PER_BAHT = 100;
const PERCENT = 100;

export type PurchaseBudgetLevel = "ok" | "low" | "over";

const LEVEL_RANK: Record<PurchaseBudgetLevel, number> = { ok: 0, low: 1, over: 2 };

export type PurchaseBudgetSettings = {
  cap: number | null;
  thresholdPct: number;
  startedOn: string | null;
};

export type PurchaseBudgetInputs = {
  cap: number;
  thresholdPct: number;
  stockValue: number;
  depositOutstanding: number;
  nonTrackedNet: number;
};

export type PurchaseBudgetFigures = PurchaseBudgetInputs & {
  used: number;
  remaining: number;
  usedPct: number;
  remainingPct: number;
  level: PurchaseBudgetLevel;
};

export type PurchaseBudgetCapMode = "add" | "subtract" | "set";

export function roundBaht(value: number): number {
  return Math.round((value + Number.EPSILON) * SATANG_PER_BAHT) / SATANG_PER_BAHT;
}

function parseFiniteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** SiteContent rows → settings. A missing or malformed cap means the budget is not set up yet. */
export function parsePurchaseBudgetSettings(rows: readonly { key: string; value: string }[]): PurchaseBudgetSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const cap = parseFiniteNumber(byKey.get(PURCHASE_BUDGET_CAP_KEY));
  const threshold = parseFiniteNumber(byKey.get(PURCHASE_BUDGET_THRESHOLD_KEY));
  const startedOn = byKey.get(PURCHASE_BUDGET_STARTED_ON_KEY)?.trim() ?? "";
  return {
    cap: cap !== null && cap >= 0 ? roundBaht(cap) : null,
    thresholdPct:
      threshold !== null && threshold >= 0 && threshold <= PURCHASE_BUDGET_MAX_THRESHOLD_PCT
        ? threshold
        : PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT,
    startedOn: isDateOnlyString(startedOn) ? startedOn : null,
  };
}

export function resolvePurchaseBudgetLevel(remaining: number, cap: number, thresholdPct: number): PurchaseBudgetLevel {
  if (remaining < 0) return "over";
  if (cap <= 0) return "low";
  return (remaining / cap) * PERCENT < thresholdPct ? "low" : "ok";
}

export function computePurchaseBudgetFigures(input: PurchaseBudgetInputs): PurchaseBudgetFigures {
  const used = roundBaht(input.stockValue + input.depositOutstanding + input.nonTrackedNet);
  const remaining = roundBaht(input.cap - used);
  return {
    ...input,
    used,
    remaining,
    usedPct: input.cap > 0 ? (used / input.cap) * PERCENT : 0,
    remainingPct: input.cap > 0 ? (remaining / input.cap) * PERCENT : 0,
    level: resolvePurchaseBudgetLevel(remaining, input.cap, input.thresholdPct),
  };
}

/** True when `after` is a worse state than `before` (ok → low → over) — the only moves that alert. */
export function isPurchaseBudgetLevelWorse(before: PurchaseBudgetLevel, after: PurchaseBudgetLevel): boolean {
  return LEVEL_RANK[after] > LEVEL_RANK[before];
}

export function applyPurchaseBudgetCapChange(
  currentCap: number | null,
  mode: PurchaseBudgetCapMode,
  amount: number,
): number {
  const base = currentCap ?? 0;
  if (mode === "add") return roundBaht(base + amount);
  if (mode === "subtract") return roundBaht(Math.max(0, base - amount));
  return roundBaht(amount);
}

/**
 * Budget a purchase uses: Σ line values + the landed-cost spread, i.e. exactly the cost the purchase
 * writes to the stock card (recoverable VAT excluded, shipping included, header discount deducted).
 * Non-tracked lines count too — they reduce the budget through the non-tracked net.
 */
export function computePurchaseBudgetUsage(input: PurchaseInventoryCostInput): number {
  const lineTotal = input.lines.reduce((sum, line) => sum + line.qty * line.costPrice, 0);
  const landedTotal = allocatePurchaseLandedCost(input).reduce((sum, amount) => sum + amount, 0);
  return roundBaht(lineTotal + landedTotal);
}

export type PurchaseBudgetFormView = {
  cap: number;
  remaining: number;
  thresholdPct: number;
};

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
    remainingAfterPct: view.cap > 0 ? (remainingAfter / view.cap) * PERCENT : 0,
    levelAfter: resolvePurchaseBudgetLevel(remainingAfter, view.cap, view.thresholdPct),
  };
}
