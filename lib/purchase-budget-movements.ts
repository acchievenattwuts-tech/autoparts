import { db } from "@/lib/db";
import { DocStatus, type Prisma, StockCardSource } from "@/lib/generated/prisma";
import { PURCHASE_BUDGET_AUDIT_ENTITY, roundBaht } from "@/lib/purchase-budget-core";
import { loadPurchaseBudgetTotals } from "@/lib/purchase-budget";
import { runAdminDashboardRead } from "@/lib/profit-dashboard-read";

/**
 * "งบขยับเดือนนี้": why the purchase budget moved since `periodStart`. Each line is the budget effect
 * (−Δ stock value, −Δ open deposits, −Δ non-tracked net, +Δ cap); the opening figure is derived as
 * remaining − Σ lines, so the panel always reconciles to the remaining budget shown above it.
 * Documents keyed later but dated before `periodStart` change the opening, not the lines.
 */

export type PurchaseBudgetMovementKey =
  | "purchase"
  | "cogs"
  | "customerReturn"
  | "supplierReturn"
  | "costAdjustment"
  | "stockAdjustment"
  | "claim"
  | "balanceForward"
  | "deposit"
  | "nonTracked"
  | "cap";

export type PurchaseBudgetMovementRow = {
  key: PurchaseBudgetMovementKey;
  label: string;
  note: string;
  amount: number;
};

const MOVEMENT_LABEL: Record<PurchaseBudgetMovementKey, string> = {
  purchase: "ซื้อสินค้าเข้า",
  cogs: "ต้นทุนสินค้าที่ขาย",
  customerReturn: "ลูกค้าคืนสินค้า",
  supplierReturn: "คืนสินค้าให้ซัพพลายเออร์",
  costAdjustment: "ใบเพิ่มหนี้ / ลดราคาซื้อ",
  stockAdjustment: "ปรับปรุงสต็อก",
  claim: "เคลมสินค้า",
  balanceForward: "ยอดยกมา",
  deposit: "มัดจำซัพพลายเออร์",
  nonTracked: "สินค้าไม่คำนวณสต็อก",
  cap: "ปรับเพดาน",
};

const STOCK_SOURCE_MOVEMENT: Record<StockCardSource, PurchaseBudgetMovementKey> = {
  [StockCardSource.PURCHASE]: "purchase",
  [StockCardSource.SALE]: "cogs",
  [StockCardSource.RETURN_IN]: "customerReturn",
  [StockCardSource.RETURN_OUT]: "supplierReturn",
  [StockCardSource.SUPPLIER_DEBIT]: "costAdjustment",
  [StockCardSource.PURCHASE_ALLOWANCE]: "costAdjustment",
  [StockCardSource.ADJUST_IN]: "stockAdjustment",
  [StockCardSource.ADJUST_OUT]: "stockAdjustment",
  [StockCardSource.CLAIM_RETURN_IN]: "claim",
  [StockCardSource.CLAIM_SEND_OUT]: "claim",
  [StockCardSource.CLAIM_RECV_IN]: "claim",
  [StockCardSource.CLAIM_REPLACE_OUT]: "claim",
  [StockCardSource.BF]: "balanceForward",
};

const MOVEMENT_ORDER: PurchaseBudgetMovementKey[] = [
  "purchase", "cogs", "customerReturn", "supplierReturn", "costAdjustment",
  "stockAdjustment", "claim", "balanceForward", "deposit", "nonTracked", "cap",
];

type StockDeltaRow = { source: StockCardSource; delta: number; docCount: number };

/**
 * Δ stock value per source for rows dated from `periodStart`: each row's balance value minus the
 * previous row of the same product, in stock-card order [productId, docDate, sorder] (index-backed).
 */
async function loadStockValueDeltas(periodStart: Date): Promise<StockDeltaRow[]> {
  const rows = await db.$queryRaw<StockDeltaRow[]>`
    WITH period_rows AS (
      SELECT sc."productId", sc."source", sc."docNo", sc."docDate", sc."sorder",
             sc."qtyBalance" * sc."priceBalance" AS "balanceValue"
      FROM "StockCard" sc
      WHERE sc."docDate" >= ${periodStart}
    ),
    touched AS (SELECT DISTINCT "productId" FROM period_rows),
    prior AS (
      SELECT DISTINCT ON (sc."productId") sc."productId", sc."qtyBalance" * sc."priceBalance" AS "balanceValue"
      FROM "StockCard" sc
      JOIN touched t ON t."productId" = sc."productId"
      WHERE sc."docDate" < ${periodStart}
      ORDER BY sc."productId", sc."docDate" DESC, sc."sorder" DESC
    ),
    deltas AS (
      SELECT r."source", r."docNo",
             r."balanceValue" - COALESCE(
               LAG(r."balanceValue") OVER (PARTITION BY r."productId" ORDER BY r."docDate", r."sorder"),
               p."balanceValue",
               0
             ) AS "delta"
      FROM period_rows r
      LEFT JOIN prior p ON p."productId" = r."productId"
    )
    SELECT "source", COALESCE(SUM("delta"), 0)::float8 AS "delta", COUNT(DISTINCT "docNo")::int AS "docCount"
    FROM deltas
    GROUP BY "source"
  `;
  return rows.map((row) => ({ source: row.source, delta: Number(row.delta), docCount: Number(row.docCount) }));
}

type DepositMovement = { change: number; paid: number; settled: number };

type AdvanceForMovement = {
  advanceDate: Date;
  totalAmount: Prisma.Decimal;
  amountRemain: Prisma.Decimal;
  supplierPayments: { paidAmount: Prisma.Decimal; payment: { paymentDate: Date } }[];
  refunds: { refundAmount: Prisma.Decimal; refundDate: Date }[];
};

/** Open deposit at `periodStart` the way recalculateSupplierAdvanceAmountRemain() computes it today. */
function outstandingAt(advance: AdvanceForMovement, periodStart: Date): number {
  if (advance.advanceDate >= periodStart) return 0;
  const applied = advance.supplierPayments
    .filter((item) => item.payment.paymentDate < periodStart)
    .reduce((sum, item) => sum + Number(item.paidAmount), 0);
  const refunded = advance.refunds
    .filter((refund) => refund.refundDate < periodStart)
    .reduce((sum, refund) => sum + Number(refund.refundAmount), 0);
  return Math.max(0, Number(advance.totalAmount) - applied - refunded);
}

async function loadDepositMovement(periodStart: Date): Promise<DepositMovement> {
  const advances: AdvanceForMovement[] = await db.supplierAdvance.findMany({
    where: {
      status: DocStatus.ACTIVE,
      OR: [
        { amountRemain: { gt: 0 } },
        { advanceDate: { gte: periodStart } },
        { supplierPayments: { some: { payment: { status: DocStatus.ACTIVE, paymentDate: { gte: periodStart } } } } },
        { refunds: { some: { status: DocStatus.ACTIVE, refundDate: { gte: periodStart } } } },
      ],
    },
    select: {
      advanceDate: true,
      totalAmount: true,
      amountRemain: true,
      supplierPayments: { where: { payment: { status: DocStatus.ACTIVE } }, select: { paidAmount: true, payment: { select: { paymentDate: true } } } },
      refunds: { where: { status: DocStatus.ACTIVE }, select: { refundAmount: true, refundDate: true } },
    },
  });
  return advances.reduce<DepositMovement>((acc, advance) => {
    const paidInPeriod = advance.advanceDate >= periodStart ? Number(advance.totalAmount) : 0;
    const settledInPeriod =
      advance.supplierPayments
        .filter((item) => item.payment.paymentDate >= periodStart)
        .reduce((sum, item) => sum + Number(item.paidAmount), 0) +
      advance.refunds
        .filter((refund) => refund.refundDate >= periodStart)
        .reduce((sum, refund) => sum + Number(refund.refundAmount), 0);
    return {
      change: acc.change + Number(advance.amountRemain) - outstandingAt(advance, periodStart),
      paid: acc.paid + paidInPeriod,
      settled: acc.settled + settledInPeriod,
    };
  }, { change: 0, paid: 0, settled: 0 });
}

function readCap(value: Prisma.JsonValue | null): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const cap = Number((value as Prisma.JsonObject).cap);
  return Number.isFinite(cap) ? cap : null;
}

/** Σ cap changes (UPDATE entries) since `periodStart`; the first-time setup is the opening, not a move. */
async function loadCapMovement(periodStart: Date): Promise<{ change: number; count: number }> {
  const entries = await db.auditLog.findMany({
    where: { entityType: PURCHASE_BUDGET_AUDIT_ENTITY, action: "UPDATE", createdAt: { gte: periodStart } },
    select: { before: true, after: true },
  });
  return entries.reduce((acc, entry) => {
    const before = readCap(entry.before);
    const after = readCap(entry.after);
    if (before === null || after === null || before === after) return acc;
    return { change: acc.change + after - before, count: acc.count + 1 };
  }, { change: 0, count: 0 });
}

function formatAmount(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function buildStockRows(deltas: StockDeltaRow[]): Map<PurchaseBudgetMovementKey, { amount: number; docs: number }> {
  const byKey = new Map<PurchaseBudgetMovementKey, { amount: number; docs: number }>();
  for (const row of deltas) {
    const key = STOCK_SOURCE_MOVEMENT[row.source];
    if (!key) continue;
    const current = byKey.get(key) ?? { amount: 0, docs: 0 };
    byKey.set(key, { amount: current.amount - row.delta, docs: current.docs + row.docCount });
  }
  return byKey;
}

/** Budget movement lines since `periodStart` (largest first in the shop's reading order). */
export async function loadPurchaseBudgetMovements(periodStart: Date): Promise<PurchaseBudgetMovementRow[]> {
  const [stockDeltas, deposit, nonTracked, cap] = await Promise.all([
    runAdminDashboardRead(() => loadStockValueDeltas(periodStart)),
    runAdminDashboardRead(() => loadDepositMovement(periodStart)),
    runAdminDashboardRead(() => loadPurchaseBudgetTotals(periodStart)),
    runAdminDashboardRead(() => loadCapMovement(periodStart)),
  ]);

  const byKey = buildStockRows(stockDeltas);
  const amounts = new Map<PurchaseBudgetMovementKey, { amount: number; note: string }>();
  for (const [key, value] of byKey) amounts.set(key, { amount: value.amount, note: `${value.docs} เอกสาร` });
  amounts.set("deposit", { amount: -deposit.change, note: `จ่าย ${formatAmount(deposit.paid)} · ตัดชำระ/รับคืน ${formatAmount(deposit.settled)}` });
  amounts.set("nonTracked", { amount: nonTracked.nonTrackedSales - nonTracked.nonTrackedPurchases, note: "ซื้อ − ต้นทุนขาย" });
  amounts.set("cap", { amount: cap.change, note: `${cap.count} ครั้ง` });

  return MOVEMENT_ORDER.flatMap((key) => {
    const entry = amounts.get(key);
    const amount = roundBaht(entry?.amount ?? 0);
    if (!entry || amount === 0) return [];
    return [{ key, label: MOVEMENT_LABEL[key], note: entry.note, amount }];
  });
}
