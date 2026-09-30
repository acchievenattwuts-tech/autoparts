import type { Prisma } from "@/lib/generated/prisma";
import {
  sameMoney,
  sameOptional,
  samePaymentRows,
  sameQuantity,
  type ComparablePaymentRow,
} from "@/lib/period-lock-document";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * Owner decisions ก2 / P4 for credit notes: in a month whose profit was already distributed the
 * note, the customer display name and each line's remarks — detail text and the reason given for
 * not restocking — may change without the override. Date, customer, source sale, type,
 * settlement, VAT, every line (product, unit, qty, price, source line, stock disposition, lots,
 * order) and the refund channels are financial.
 */

type Amount = number | string | { toString(): string };

const RETURN_TYPE = "RETURN";
const DEFAULT_DISPOSITION = "RESTOCK";

export const CREDIT_NOTE_PERIOD_LOCK_ALLOWED_EDITS_HINT =
  "แก้หมายเหตุ ชื่อลูกค้าบนเอกสาร รายละเอียดเพิ่มเติมของแต่ละรายการ และเหตุผลที่ไม่รับเข้าสต๊อกได้โดยไม่ต้องปลดล็อก";

export type CreditNoteHeaderState = {
  cnDate: Date;
  customerId: string | null;
  saleId: string | null;
  type: string;
  settlementType: string;
  vatType: string;
  vatRate: Amount;
};

export type StoredCreditNoteLine = {
  productId: string | null;
  saleItemId: string | null;
  stockDisposition: string;
  stockDispositionNote: string | null;
  qty: Amount;
  unitPrice: Amount;
  showQty: Amount | null;
  showUnitName: string | null;
  moreDetail: string | null;
  lots: Array<{ lotNo: string; qty: Amount; isReturnLot: boolean }>;
};

export type StoredCreditNoteFinancialState = CreditNoteHeaderState & {
  /** `id` lets the non-financial path save a line's remarks (P4). */
  lines: Array<StoredCreditNoteLine & { id: string }>;
  payments: ComparablePaymentRow[];
};

export type SubmittedCreditNoteLine = {
  productId: string;
  saleItemId?: string;
  unitName: string;
  qty: number;
  salePrice: number;
  moreDetail?: string;
  stockDisposition: string;
  stockDispositionNote?: string;
  lotItems: Array<{ lotNo: string; qty: number; isReturnLot: boolean }>;
};

const lotKeys = (lots: Array<{ lotNo: string; qty: Amount; isReturnLot: boolean }>, scale: number): string =>
  lots
    .map((lot) => `${lot.lotNo.trim()}|${Math.round(Number(lot.qty) * scale * 10_000)}|${lot.isReturnLot ? 1 : 0}`)
    .sort()
    .join("//");

function sameCreditNoteLine(
  stored: StoredCreditNoteLine,
  submitted: SubmittedCreditNoteLine,
  isReturn: boolean,
  scale: number,
): boolean {
  return (
    stored.productId === submitted.productId &&
    sameOptional(stored.saleItemId, isReturn ? submitted.saleItemId : null) &&
    stored.stockDisposition === (isReturn ? submitted.stockDisposition : DEFAULT_DISPOSITION) &&
    // stockDispositionNote and moreDetail are remarks (P4): not compared.
    sameQuantity(stored.qty, submitted.qty * scale) &&
    (stored.showQty === null || sameQuantity(stored.showQty, submitted.qty)) &&
    (stored.showUnitName === null || stored.showUnitName === submitted.unitName) &&
    sameMoney(stored.unitPrice, submitted.salePrice) &&
    lotKeys(stored.lots, 1) === lotKeys(submitted.lotItems, scale)
  );
}

export function isCreditNoteNonFinancialChange(
  stored: CreditNoteHeaderState & { lines: StoredCreditNoteLine[]; payments: ComparablePaymentRow[] },
  submitted: CreditNoteHeaderState & { lines: SubmittedCreditNoteLine[]; payments: ComparablePaymentRow[] },
  scaleOf: (line: SubmittedCreditNoteLine) => number,
): boolean {
  const isReturn = submitted.type === RETURN_TYPE;
  return (
    getThailandDateKey(stored.cnDate) === getThailandDateKey(submitted.cnDate) &&
    sameOptional(stored.customerId, submitted.customerId) &&
    sameOptional(stored.saleId, submitted.saleId) &&
    stored.type === submitted.type &&
    stored.settlementType === submitted.settlementType &&
    stored.vatType === submitted.vatType &&
    sameMoney(stored.vatRate, submitted.vatRate) &&
    stored.lines.length === submitted.lines.length &&
    stored.lines.every((line, index) =>
      sameCreditNoteLine(line, submitted.lines[index], isReturn, scaleOf(submitted.lines[index])),
    ) &&
    samePaymentRows(stored.payments, submitted.payments)
  );
}

/** The line remarks the non-financial path saves; non-RETURN lines never keep a disposition reason. */
export function toCreditNoteLineRemarks(
  lines: ReadonlyArray<Pick<SubmittedCreditNoteLine, "moreDetail" | "stockDispositionNote">>,
  type: string,
): Array<{ moreDetail: string | null; stockDispositionNote: string | null }> {
  const isReturn = type === RETURN_TYPE;
  return lines.map((line) => ({
    moreDetail: line.moreDetail || null,
    stockDispositionNote: isReturn ? line.stockDispositionNote || null : null,
  }));
}

/** The stored CN, its lines and refund rows, read with the transaction client under the CN row lock. */
export async function loadCreditNoteFinancialState(
  tx: Prisma.TransactionClient,
  creditNoteId: string,
): Promise<StoredCreditNoteFinancialState | null> {
  try {
    const [creditNote, payments] = await Promise.all([
      tx.creditNote.findUnique({
        where: { id: creditNoteId },
        select: {
          cnDate: true,
          customerId: true,
          saleId: true,
          type: true,
          settlementType: true,
          vatType: true,
          vatRate: true,
          items: {
            orderBy: [{ lineNo: "asc" }, { id: "asc" }],
            select: {
              id: true,
              productId: true,
              saleItemId: true,
              stockDisposition: true,
              stockDispositionNote: true,
              qty: true,
              unitPrice: true,
              showQty: true,
              showUnitName: true,
              moreDetail: true,
              lotItems: { orderBy: { id: "asc" }, select: { lotNo: true, qty: true, isReturnLot: true } },
            },
          },
        },
      }),
      tx.documentPayment.findMany({
        where: { docType: "CN_SALE", docId: creditNoteId },
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: { cashBankAccountId: true, amount: true },
      }),
    ]);
    if (!creditNote) return null;
    const { items, ...header } = creditNote;
    return {
      ...header,
      lines: items.map(({ lotItems, ...line }) => ({ ...line, lots: lotItems })),
      payments,
    };
  } catch (error) {
    throw new Error("Failed to load credit note for the period lock check", { cause: error });
  }
}
