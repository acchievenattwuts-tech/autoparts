import { db } from "@/lib/db";
import { DocStatus, PaymentMethod, PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import {
  getThailandDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

/**
 * Bank-transfer reconciliation (read-only). Compares, per day, the money customers
 * SAY they transferred (confirmed LINE payment slips) against what the shop officially
 * recorded as received by transfer (ACTIVE receipts with paymentMethod = TRANSFER).
 *
 * This is an aggregate/period comparison — slips and receipts are NOT line-matched
 * (PaymentSlip.matchedSaleId stays null by design). It never mutates accounting truth.
 */

export type ReconciliationDayRow = {
  dateKey: string; // YYYY-MM-DD (Thailand)
  slipCount: number;
  slipAmount: number;
  receiptCount: number;
  receiptAmount: number;
  /** slipAmount - receiptAmount. >0: slips exceed transfer receipts; <0: the reverse. */
  variance: number;
};

export type ReconciliationTotals = {
  slipCount: number;
  slipAmount: number;
  receiptCount: number;
  receiptAmount: number;
  variance: number;
};

export type ReconciliationReport = {
  rows: ReconciliationDayRow[]; // newest day first
  totals: ReconciliationTotals;
};

type DayAccumulator = {
  slipCount: number;
  slipAmount: number;
  receiptCount: number;
  receiptAmount: number;
};

function emptyDay(): DayAccumulator {
  return { slipCount: 0, slipAmount: 0, receiptCount: 0, receiptAmount: 0 };
}

function decimalToNumber(value: { toString(): string } | null): number {
  if (value === null) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getPaymentReconciliation(input: {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}): Promise<ReconciliationReport> {
  const fromDate = parseDateOnlyToStartOfDay(input.from);
  const toDate = parseDateOnlyToEndOfDay(input.to);

  // Confirmed slips = money the customer reported as transferred. Range matches the
  // effective date (transfer date when OCR read it, else the received/createdAt date).
  const [slips, receipts] = await Promise.all([
    db.paymentSlip.findMany({
      where: {
        verificationStatus: PaymentSlipVerificationStatus.CONFIRMED_BY_ADMIN,
        OR: [
          { detectedTransferDatetime: { gte: fromDate, lte: toDate } },
          { detectedTransferDatetime: null, createdAt: { gte: fromDate, lte: toDate } },
        ],
      },
      select: { detectedAmount: true, detectedTransferDatetime: true, createdAt: true },
    }),
    db.receipt.findMany({
      where: {
        paymentMethod: PaymentMethod.TRANSFER,
        status: DocStatus.ACTIVE,
        receiptDate: { gte: fromDate, lte: toDate },
      },
      select: { totalAmount: true, receiptDate: true },
    }),
  ]);

  const byDay = new Map<string, DayAccumulator>();
  const bump = (dateKey: string): DayAccumulator => {
    const existing = byDay.get(dateKey);
    if (existing) return existing;
    const created = emptyDay();
    byDay.set(dateKey, created);
    return created;
  };

  for (const slip of slips) {
    const effective = slip.detectedTransferDatetime ?? slip.createdAt;
    const day = bump(getThailandDateKey(effective));
    day.slipCount += 1;
    day.slipAmount += decimalToNumber(slip.detectedAmount);
  }

  for (const receipt of receipts) {
    const day = bump(getThailandDateKey(receipt.receiptDate));
    day.receiptCount += 1;
    day.receiptAmount += decimalToNumber(receipt.totalAmount);
  }

  const rows: ReconciliationDayRow[] = Array.from(byDay.entries())
    .map(([dateKey, acc]) => ({
      dateKey,
      slipCount: acc.slipCount,
      slipAmount: acc.slipAmount,
      receiptCount: acc.receiptCount,
      receiptAmount: acc.receiptAmount,
      variance: acc.slipAmount - acc.receiptAmount,
    }))
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));

  const totals: ReconciliationTotals = rows.reduce<ReconciliationTotals>(
    (acc, row) => ({
      slipCount: acc.slipCount + row.slipCount,
      slipAmount: acc.slipAmount + row.slipAmount,
      receiptCount: acc.receiptCount + row.receiptCount,
      receiptAmount: acc.receiptAmount + row.receiptAmount,
      variance: acc.variance + row.variance,
    }),
    { slipCount: 0, slipAmount: 0, receiptCount: 0, receiptAmount: 0, variance: 0 },
  );

  return { rows, totals };
}
