import { db } from "@/lib/db";
import { DocStatus, PurchaseType, SalePaymentType, type Prisma } from "@/lib/generated/prisma";
import { getCashHealth } from "@/lib/profit-distribution";
import { runAdminDashboardRead } from "@/lib/profit-dashboard-read";
import { getPurchaseBudgetSnapshot, getPurchaseBudgetSettings } from "@/lib/purchase-budget";
import {
  PURCHASE_BUDGET_AUDIT_ENTITY,
  roundBaht,
  type PurchaseBudgetFigures,
  type PurchaseBudgetSettings,
} from "@/lib/purchase-budget-core";
import { formatDateThai, formatDateTimeThai, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/** Everything the "Purchase Budget" dashboard tab renders on load (the ledger loads on demand). */

const DEPOSIT_LIST_LIMIT = 20;
const HISTORY_LIMIT = 5;

export type PurchaseBudgetDepositRow = {
  id: string;
  advanceNo: string;
  supplierName: string;
  advanceDate: string;
  total: number;
  /** Applied in supplier payments or refunded. */
  used: number;
  remaining: number;
};

export type PurchaseBudgetHistoryRow = {
  id: string;
  when: string;
  who: string;
  change: string;
  reason: string;
};

export type PurchaseBudgetCashView = {
  /** null when the viewer may not see cash/bank balances (cash_bank.view). */
  cashBankBalance: number | null;
  apOutstanding: number;
  arOutstanding: number;
};

export type PurchaseBudgetDashboardData = {
  settings: PurchaseBudgetSettings;
  figures: PurchaseBudgetFigures | null;
  startedOnLabel: string | null;
  deposits: PurchaseBudgetDepositRow[];
  depositsTotalRemaining: number;
  depositsTruncated: boolean;
  cash: PurchaseBudgetCashView;
  history: PurchaseBudgetHistoryRow[];
  asOf: string;
};

/** Open supplier deposits — information only, they never use the budget (owner decision 2026-10-04). */
async function loadDeposits(): Promise<{ rows: PurchaseBudgetDepositRow[]; totalRemaining: number; truncated: boolean }> {
  const where = { status: DocStatus.ACTIVE, amountRemain: { gt: 0 } };
  const [advances, total] = await Promise.all([
    db.supplierAdvance.findMany({
      where,
      orderBy: [{ advanceDate: "asc" }, { advanceNo: "asc" }],
      take: DEPOSIT_LIST_LIMIT + 1,
      select: { id: true, advanceNo: true, advanceDate: true, totalAmount: true, amountRemain: true, supplier: { select: { name: true } } },
    }),
    db.supplierAdvance.aggregate({ where, _sum: { amountRemain: true } }),
  ]);
  const rows = advances.slice(0, DEPOSIT_LIST_LIMIT).map((advance): PurchaseBudgetDepositRow => ({
    id: advance.id,
    advanceNo: advance.advanceNo,
    supplierName: advance.supplier.name,
    advanceDate: formatDateThai(advance.advanceDate),
    total: Number(advance.totalAmount),
    used: roundBaht(Number(advance.totalAmount) - Number(advance.amountRemain)),
    remaining: Number(advance.amountRemain),
  }));
  return { rows, totalRemaining: roundBaht(Number(total._sum.amountRemain ?? 0)), truncated: advances.length > DEPOSIT_LIST_LIMIT };
}

const isRecord = (value: Prisma.JsonValue | null): value is Prisma.JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function readNumber(value: Prisma.JsonValue | null, key: string): number | null {
  if (!isRecord(value) || value[key] === null || value[key] === undefined) return null;
  const parsed = Number(value[key]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readText(value: Prisma.JsonValue | null, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? (value[key] as string) : null;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function describeChange(before: Prisma.JsonValue | null, after: Prisma.JsonValue | null, meta: Prisma.JsonValue | null): string {
  const mode = readText(meta, "mode");
  const from = readNumber(before, "cap");
  const to = readNumber(after, "cap");
  const startedOn = readText(meta, "startedOn");
  const parts: string[] = [];
  if ((mode === "set" || mode === "restart") && to !== null) {
    const startLabel = startedOn ? ` เริ่มนับ ${formatDateThai(parseDateOnlyToStartOfDay(startedOn))}` : "";
    parts.push(`${from === null ? "ตั้งงบ" : "เริ่มรอบใหม่"} ${money(to)}${startLabel}`);
  } else if (from !== null && to !== null && from !== to) {
    parts.push(`${to > from ? "เพิ่มงบ" : "ลดงบ"} ${money(Math.abs(to - from))} (${money(from)} → ${money(to)})`);
  }
  const thresholdFrom = readNumber(before, "thresholdPct");
  const thresholdTo = readNumber(after, "thresholdPct");
  if (thresholdTo !== null && thresholdFrom !== null && thresholdFrom !== thresholdTo) parts.push(`เส้นเตือน ${thresholdFrom}% → ${thresholdTo}%`);
  return parts.length > 0 ? parts.join(" · ") : "ไม่มีการเปลี่ยนค่า";
}

async function loadHistory(): Promise<PurchaseBudgetHistoryRow[]> {
  const entries = await db.auditLog.findMany({
    where: { entityType: PURCHASE_BUDGET_AUDIT_ENTITY },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, createdAt: true, userName: true, before: true, after: true, meta: true },
  });
  return entries.map((entry) => ({
    id: entry.id,
    when: formatDateTimeThai(entry.createdAt),
    who: entry.userName ?? "-",
    change: describeChange(entry.before, entry.after, entry.meta),
    reason: readText(entry.meta, "reason") ?? "-",
  }));
}

async function loadCashView(canViewCash: boolean): Promise<PurchaseBudgetCashView> {
  const [purchases, debitNotes, receivables, cashHealth] = await Promise.all([
    runAdminDashboardRead(() => db.purchase.aggregate({
      _sum: { amountRemain: true },
      where: { status: DocStatus.ACTIVE, purchaseType: PurchaseType.CREDIT_PURCHASE, amountRemain: { gt: 0 } },
    })),
    // DN payables minus "ปรับยอด DN" supplier credit (negative amountRemain) — as the daily dashboard.
    runAdminDashboardRead(() => db.supplierDebitNote.aggregate({
      _sum: { amountRemain: true },
      where: { status: DocStatus.ACTIVE, amountRemain: { not: 0 } },
    })),
    runAdminDashboardRead(() => db.sale.aggregate({
      _sum: { amountRemain: true },
      where: { status: DocStatus.ACTIVE, paymentType: SalePaymentType.CREDIT_SALE, amountRemain: { gt: 0 } },
    })),
    canViewCash ? runAdminDashboardRead(() => getCashHealth()) : Promise.resolve(null),
  ]);
  return {
    cashBankBalance: cashHealth ? cashHealth.cashBankBalance : null,
    apOutstanding: roundBaht(Number(purchases._sum.amountRemain ?? 0) + Number(debitNotes._sum.amountRemain ?? 0)),
    arOutstanding: roundBaht(Number(receivables._sum.amountRemain ?? 0)),
  };
}

export async function getPurchaseBudgetDashboardData(options: { canViewCash: boolean; now?: Date }): Promise<PurchaseBudgetDashboardData> {
  const now = options.now ?? new Date();
  const [settings, snapshot, deposits, cash, history] = await Promise.all([
    runAdminDashboardRead(() => getPurchaseBudgetSettings()),
    runAdminDashboardRead(() => getPurchaseBudgetSnapshot()),
    runAdminDashboardRead(() => loadDeposits()),
    loadCashView(options.canViewCash),
    runAdminDashboardRead(() => loadHistory()),
  ]);
  return {
    settings,
    figures: snapshot?.figures ?? null,
    startedOnLabel: settings.startedOn ? formatDateThai(parseDateOnlyToStartOfDay(settings.startedOn), { day: "numeric", month: "short", year: "numeric" }) : null,
    deposits: deposits.rows,
    depositsTotalRemaining: deposits.totalRemaining,
    depositsTruncated: deposits.truncated,
    cash,
    history,
    asOf: formatDateTimeThai(now),
  };
}
