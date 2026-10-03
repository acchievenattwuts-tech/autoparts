import { db } from "@/lib/db";
import { DocStatus, PurchaseType, SalePaymentType, type Prisma } from "@/lib/generated/prisma";
import { getCashHealth } from "@/lib/profit-distribution";
import { runAdminDashboardRead } from "@/lib/profit-dashboard-read";
import {
  buildPurchaseBudgetFigures,
  getPurchaseBudgetSettings,
  getPurchaseBudgetStartedAt,
  loadPurchaseBudgetTotals,
  type PurchaseBudgetTotals,
} from "@/lib/purchase-budget";
import {
  PURCHASE_BUDGET_AUDIT_ENTITY,
  roundBaht,
  type PurchaseBudgetFigures,
  type PurchaseBudgetSettings,
} from "@/lib/purchase-budget-core";
import { loadPurchaseBudgetMovements, type PurchaseBudgetMovementRow } from "@/lib/purchase-budget-movements";
import {
  formatDateThai,
  formatDateTimeThai,
  getThailandMonthStartDateKey,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

/** Everything the "Purchase Budget" dashboard tab shows, already serializable for Server Components. */

const DEPOSIT_LIST_LIMIT = 20;
const HISTORY_LIMIT = 5;
const OVERLAP_PURCHASE_SCAN_LIMIT = 200;

export type PurchaseBudgetDepositRow = {
  id: string;
  advanceNo: string;
  supplierName: string;
  advanceDate: string;
  amount: number;
  /** An unpaid purchase from the same supplier dated on/after the deposit: the deposit may be its goods. */
  overlapPurchaseNo: string | null;
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

export type PurchaseBudgetMovementView = {
  periodLabel: string;
  openingLabel: string;
  opening: number;
  rows: PurchaseBudgetMovementRow[];
};

export type PurchaseBudgetDashboardData = {
  settings: PurchaseBudgetSettings;
  totals: PurchaseBudgetTotals;
  figures: PurchaseBudgetFigures | null;
  deposits: PurchaseBudgetDepositRow[];
  depositsTruncated: boolean;
  cash: PurchaseBudgetCashView;
  history: PurchaseBudgetHistoryRow[];
  movements: PurchaseBudgetMovementView | null;
  asOf: string;
};

async function loadDeposits(): Promise<{ rows: PurchaseBudgetDepositRow[]; truncated: boolean }> {
  const advances = await db.supplierAdvance.findMany({
    where: { status: DocStatus.ACTIVE, amountRemain: { gt: 0 } },
    orderBy: [{ advanceDate: "asc" }, { advanceNo: "asc" }],
    take: DEPOSIT_LIST_LIMIT + 1,
    select: { id: true, advanceNo: true, advanceDate: true, amountRemain: true, supplierId: true, supplier: { select: { name: true } } },
  });
  const shown = advances.slice(0, DEPOSIT_LIST_LIMIT);
  const supplierIds = [...new Set(shown.map((advance) => advance.supplierId))];
  const earliest = shown[0]?.advanceDate;
  const unpaidPurchases = supplierIds.length === 0 || !earliest
    ? []
    : await db.purchase.findMany({
        where: { status: DocStatus.ACTIVE, amountRemain: { gt: 0 }, supplierId: { in: supplierIds }, purchaseDate: { gte: earliest } },
        orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
        take: OVERLAP_PURCHASE_SCAN_LIMIT,
        select: { purchaseNo: true, supplierId: true, purchaseDate: true },
      });
  const rows = shown.map((advance): PurchaseBudgetDepositRow => ({
    id: advance.id,
    advanceNo: advance.advanceNo,
    supplierName: advance.supplier.name,
    advanceDate: formatDateThai(advance.advanceDate),
    amount: Number(advance.amountRemain),
    overlapPurchaseNo:
      unpaidPurchases.find((purchase) => purchase.supplierId === advance.supplierId && purchase.purchaseDate >= advance.advanceDate)
        ?.purchaseNo ?? null,
  }));
  return { rows, truncated: advances.length > DEPOSIT_LIST_LIMIT };
}

function readSettingsJson(value: Prisma.JsonValue | null): { cap: number | null; thresholdPct: number | null } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { cap: null, thresholdPct: null };
  const object = value as Prisma.JsonObject;
  const cap = Number(object.cap);
  const thresholdPct = Number(object.thresholdPct);
  return {
    cap: object.cap === null || object.cap === undefined || !Number.isFinite(cap) ? null : cap,
    thresholdPct: Number.isFinite(thresholdPct) ? thresholdPct : null,
  };
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function describeChange(before: Prisma.JsonValue | null, after: Prisma.JsonValue | null): string {
  const from = readSettingsJson(before);
  const to = readSettingsJson(after);
  const parts: string[] = [];
  if (from.cap === null && to.cap !== null) parts.push(`ตั้งครั้งแรก ${money(to.cap)}`);
  else if (to.cap !== null && from.cap !== to.cap) parts.push(`${money(from.cap ?? 0)} → ${money(to.cap)}`);
  if (to.thresholdPct !== null && from.thresholdPct !== null && from.thresholdPct !== to.thresholdPct) {
    parts.push(`เส้นเตือน ${from.thresholdPct}% → ${to.thresholdPct}%`);
  } else if (from.cap === null && to.thresholdPct !== null) {
    parts.push(`เส้นเตือน ${to.thresholdPct}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : "ไม่มีการเปลี่ยนค่า";
}

function readReason(meta: Prisma.JsonValue | null): string {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return "-";
  const reason = (meta as Prisma.JsonObject).reason;
  return typeof reason === "string" && reason.trim() ? reason : "-";
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
    change: describeChange(entry.before, entry.after),
    reason: readReason(entry.meta),
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

/** Month start, or the day the budget started when that is later — the movement panel's opening point. */
function resolveMovementPeriod(settings: PurchaseBudgetSettings, now: Date): { start: Date; startedThisPeriod: boolean } {
  const monthStartKey = getThailandMonthStartDateKey(now);
  const startedLater = settings.startedOn !== null && settings.startedOn > monthStartKey;
  return {
    start: parseDateOnlyToStartOfDay(startedLater && settings.startedOn ? settings.startedOn : monthStartKey),
    startedThisPeriod: startedLater,
  };
}

async function loadMovementView(settings: PurchaseBudgetSettings, figures: PurchaseBudgetFigures, now: Date): Promise<PurchaseBudgetMovementView> {
  const period = resolveMovementPeriod(settings, now);
  const rows = await loadPurchaseBudgetMovements(period.start);
  const totalMove = rows.reduce((sum, row) => sum + row.amount, 0);
  const startLabel = formatDateThai(period.start, { day: "numeric", month: "short" });
  return {
    periodLabel: `${formatDateThai(period.start, { day: "numeric" })}–${formatDateThai(now, { day: "numeric", month: "short", year: "numeric" })}`,
    openingLabel: period.startedThisPeriod ? `งบตอนเริ่มใช้ (${startLabel})` : `งบต้นเดือน (${startLabel})`,
    opening: roundBaht(figures.remaining - totalMove),
    rows,
  };
}

export async function getPurchaseBudgetDashboardData(options: { canViewCash: boolean; now?: Date }): Promise<PurchaseBudgetDashboardData> {
  const now = options.now ?? new Date();
  const settings = await runAdminDashboardRead(() => getPurchaseBudgetSettings());
  const [totals, deposits, cash, history] = await Promise.all([
    runAdminDashboardRead(() => loadPurchaseBudgetTotals(getPurchaseBudgetStartedAt(settings))),
    runAdminDashboardRead(() => loadDeposits()),
    loadCashView(options.canViewCash),
    runAdminDashboardRead(() => loadHistory()),
  ]);
  const figures = settings.cap === null ? null : buildPurchaseBudgetFigures(settings.cap, settings.thresholdPct, totals);
  const movements = figures ? await loadMovementView(settings, figures, now) : null;
  return {
    settings,
    totals,
    figures,
    deposits: deposits.rows,
    depositsTruncated: deposits.truncated,
    cash,
    history,
    movements,
    asOf: formatDateTimeThai(now),
  };
}
