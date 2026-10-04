import { roundBaht } from "@/lib/purchase-budget-core";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * Budget-side entries of the purchase budget ledger (pure): the start of the current round and the
 * top-ups / cuts after it, read from the AuditLog the cap action writes, plus the day grouping the
 * ledger shows (budget entries + document effects, with the balance at the end of each day).
 */

export type PurchaseBudgetAuditEntry = {
  id: string;
  createdAt: Date;
  userName: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
};

export type PurchaseBudgetEventKind = "start" | "restart" | "add" | "subtract";

export type PurchaseBudgetEvent = {
  id: string;
  dateKey: string;
  kind: PurchaseBudgetEventKind;
  /** Signed budget change; for a start / restart the amount set. */
  amount: number;
  who: string;
  reason: string;
};

export type PurchaseBudgetDocDay = { dateKey: string; plus: number; minus: number; docCount: number };

export type PurchaseBudgetLedgerDay = {
  dateKey: string;
  budgetChange: number;
  plus: number;
  minus: number;
  net: number;
  entryCount: number;
  endBalance: number;
};

const ROUND_START_MODES = new Set(["set", "restart"]);
const ADJUST_MODES = new Set(["add", "subtract"]);
const HALF_SATANG = 0.005;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value) || value[key] === null || value[key] === undefined) return null;
  const parsed = Number(value[key]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? (value[key] as string) : null;
}

/** The current round's events, oldest first: its start (or restart) and every top-up / cut after it. */
export function resolvePurchaseBudgetRound(entries: readonly PurchaseBudgetAuditEntry[]): PurchaseBudgetEvent[] {
  const sorted = [...entries].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const startIndex = sorted.reduce((found, entry, index) => (ROUND_START_MODES.has(readString(entry.meta, "mode") ?? "") ? index : found), -1);
  if (startIndex < 0) return [];

  const start = sorted[startIndex];
  const startAmount = readNumber(start.after, "cap");
  const events: PurchaseBudgetEvent[] = [];
  if (startAmount !== null) {
    events.push({
      id: start.id,
      dateKey: readString(start.meta, "startedOn") ?? getThailandDateKey(start.createdAt),
      kind: readNumber(start.before, "cap") === null ? "start" : "restart",
      amount: roundBaht(startAmount),
      who: start.userName ?? "-",
      reason: readString(start.meta, "reason") ?? "-",
    });
  }
  for (const entry of sorted.slice(startIndex + 1)) {
    const mode = readString(entry.meta, "mode") ?? "";
    const before = readNumber(entry.before, "cap");
    const after = readNumber(entry.after, "cap");
    if (!ADJUST_MODES.has(mode) || before === null || after === null) continue;
    const amount = roundBaht(after - before);
    if (Math.abs(amount) < HALF_SATANG) continue;
    events.push({
      id: entry.id,
      dateKey: getThailandDateKey(entry.createdAt),
      kind: amount > 0 ? "add" : "subtract",
      amount,
      who: entry.userName ?? "-",
      reason: readString(entry.meta, "reason") ?? "-",
    });
  }
  return events;
}

/**
 * Keeps the ledger equal to the stored settings, which are the source of truth: the round starts on the
 * stored start date (a synthetic start when the audit trail has none), no entry is dated before it, and
 * any difference against the stored amount (history written before this ledger existed) lands on the start.
 */
export function reconcilePurchaseBudgetEvents(
  events: readonly PurchaseBudgetEvent[],
  budget: number,
  startedOn: string,
): PurchaseBudgetEvent[] {
  const [first, ...rest] = events;
  const hasStart = first !== undefined && (first.kind === "start" || first.kind === "restart");
  const start: PurchaseBudgetEvent = hasStart
    ? { ...first, dateKey: startedOn }
    : { id: "start", dateKey: startedOn, kind: "start", amount: 0, who: "-", reason: "-" };
  const adjustments = (hasStart ? rest : events).map((event) =>
    event.dateKey < startedOn ? { ...event, dateKey: startedOn } : event);
  const difference = roundBaht(budget - start.amount - adjustments.reduce((sum, event) => sum + event.amount, 0));
  const reconciledStart = Math.abs(difference) < HALF_SATANG ? start : { ...start, amount: roundBaht(start.amount + difference) };
  return [reconciledStart, ...adjustments];
}

/** Days with any budget entry or counted document, oldest first, with the balance at each day's end. */
export function buildPurchaseBudgetLedgerDays(
  docDays: readonly PurchaseBudgetDocDay[],
  events: readonly PurchaseBudgetEvent[],
): PurchaseBudgetLedgerDay[] {
  const byDate = new Map<string, { budgetChange: number; plus: number; minus: number; entryCount: number }>();
  const slot = (dateKey: string) => {
    const existing = byDate.get(dateKey);
    if (existing) return existing;
    const created = { budgetChange: 0, plus: 0, minus: 0, entryCount: 0 };
    byDate.set(dateKey, created);
    return created;
  };
  for (const day of docDays) {
    const entry = slot(day.dateKey);
    entry.plus += day.plus;
    entry.minus += day.minus;
    entry.entryCount += day.docCount;
  }
  for (const event of events) {
    const entry = slot(event.dateKey);
    entry.budgetChange += event.amount;
    entry.entryCount += 1;
  }

  let balance = 0;
  return [...byDate.keys()].sort().map((dateKey) => {
    const entry = byDate.get(dateKey) ?? { budgetChange: 0, plus: 0, minus: 0, entryCount: 0 };
    const net = roundBaht(entry.budgetChange + entry.plus + entry.minus);
    balance = roundBaht(balance + net);
    return {
      dateKey,
      budgetChange: roundBaht(entry.budgetChange),
      plus: roundBaht(entry.plus),
      minus: roundBaht(entry.minus),
      net,
      entryCount: entry.entryCount,
      endBalance: balance,
    };
  });
}
