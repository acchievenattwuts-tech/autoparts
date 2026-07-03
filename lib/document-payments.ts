import { z } from "zod";
import {
  CashBankDirection,
  DocumentPaymentDocType,
  Prisma,
} from "@/lib/generated/prisma";

type TxClient = Prisma.TransactionClient;

// Tolerance for float rounding when comparing the sum of split rows against a
// document total (both are 2-decimal money values).
const AMOUNT_EPSILON = 0.005;

export interface DocumentPaymentRow {
  cashBankAccountId: string;
  amount: number;
  note?: string | null;
}

const documentPaymentRowSchema = z.object({
  cashBankAccountId: z.string().min(1, "กรุณาเลือกบัญชีรับ/จ่ายเงิน"),
  amount: z.coerce.number().positive("จำนวนเงินแต่ละช่องทางต้องมากกว่า 0"),
  note: z.string().max(200).optional(),
});

const documentPaymentRowsSchema = z.array(documentPaymentRowSchema);

/**
 * Parse the `payments` JSON field submitted from a split-payment form.
 * Returns [] for an empty/absent field. Throws a ZodError on malformed rows,
 * which callers should map to a Thai message.
 */
export function parseDocumentPaymentRows(raw: FormDataEntryValue | null): DocumentPaymentRow[] {
  if (raw == null) return [];
  const parsed = documentPaymentRowsSchema.parse(JSON.parse(String(raw) || "[]"));
  return parsed.map((row) => ({
    cashBankAccountId: row.cashBankAccountId,
    amount: row.amount,
    note: row.note ?? null,
  }));
}

export function sumDocumentPaymentRows(rows: DocumentPaymentRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

/**
 * Verify the split rows add up to the expected money total (within rounding
 * tolerance). Throws a Thai error on mismatch. Pass expectedTotal as the
 * absolute cash amount that must move for this document.
 */
export function assertPaymentsMatchTotal(
  rows: DocumentPaymentRow[],
  expectedTotal: number,
): void {
  const total = sumDocumentPaymentRows(rows);
  if (Math.abs(total - expectedTotal) > AMOUNT_EPSILON) {
    throw new Error(
      `ยอดรวมช่องทางรับ/จ่าย (${total.toLocaleString("th-TH", {
        minimumFractionDigits: 2,
      })}) ไม่ตรงกับยอดเอกสาร (${expectedTotal.toLocaleString("th-TH", {
        minimumFractionDigits: 2,
      })})`,
    );
  }
}

/** First-row account id, kept on the owning document for back-compat/label. */
export function derivePrimaryAccountId(rows: DocumentPaymentRow[]): string | null {
  return rows[0]?.cashBankAccountId ?? null;
}

/**
 * Replace all split-payment rows for a document. Deletes existing rows for
 * (docType, docId) then inserts the new set. Must run inside the same
 * transaction that posts the matching CashBankMovement entries.
 */
export async function replaceDocumentPayments(
  tx: TxClient,
  docType: DocumentPaymentDocType,
  docId: string,
  direction: CashBankDirection,
  rows: DocumentPaymentRow[],
): Promise<void> {
  await tx.documentPayment.deleteMany({ where: { docType, docId } });

  const validRows = rows.filter((row) => row.amount > 0);
  if (validRows.length === 0) return;

  await tx.documentPayment.createMany({
    data: validRows.map((row, index) => ({
      docType,
      docId,
      lineNo: index + 1,
      cashBankAccountId: row.cashBankAccountId,
      direction,
      amount: row.amount,
      note: row.note ?? null,
    })),
  });
}

/** Remove all split-payment rows for a document (used on cancel). */
export async function clearDocumentPayments(
  tx: TxClient,
  docType: DocumentPaymentDocType,
  docId: string,
): Promise<void> {
  await tx.documentPayment.deleteMany({ where: { docType, docId } });
}

export interface CashBankEntryForPost {
  accountId: string;
  txnDate: Date;
  direction: CashBankDirection;
  amount: number;
  referenceNo: string;
  note?: string | null;
}

/**
 * Map split-payment rows into the entry array expected by
 * `replaceCashBankSourceMovements`. Rows with amount <= 0 are dropped.
 */
export function toCashBankEntries(
  rows: DocumentPaymentRow[],
  opts: { txnDate: Date; direction: CashBankDirection; referenceNo: string; note?: string | null },
): CashBankEntryForPost[] {
  return rows
    .filter((row) => row.amount > 0)
    .map((row) => ({
      accountId: row.cashBankAccountId,
      txnDate: opts.txnDate,
      direction: opts.direction,
      amount: row.amount,
      referenceNo: opts.referenceNo,
      // Preserve the legacy ledger note (document-level) as the default; a
      // per-row note overrides it when provided.
      note: row.note ?? opts.note ?? null,
    }));
}
