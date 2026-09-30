import type { Prisma } from "@/lib/generated/prisma";
import { sameMoney, sameOptional, samePaymentRows, type ComparablePaymentRow } from "@/lib/period-lock-document";
import { getThailandDateKey } from "@/lib/th-date";
import { isInputVatRecoverable } from "@/lib/input-vat";

/**
 * Owner decisions ก2 / P4 for expenses: in a month whose profit was already distributed, the note
 * and each line's description (a remark) may change without the override. Everything else — date,
 * payee, VAT, lines (code, amount, order), payment channels and withholding tax — counts as a
 * financial change. V7: the tax-invoice number is a remark, and so is its date unless the change flips
 * whether the VAT is recoverable input tax (lib/input-vat.ts), which moves the expense amount.
 */

type Amount = number | string | { toString(): string };

export type ExpenseWhtLine = {
  incomeTypeId: string;
  baseAmount: Amount;
  rate: Amount;
  taxAmount: Amount;
  payCondition: string;
};

export type ExpenseLineState = { expenseCodeId: string; description: string | null; amount: Amount };

export type ExpenseFinancialState = {
  expenseDate: Date;
  supplierId: string | null;
  vatType: string;
  vatRate: Amount;
  /** V7: the VAT is recoverable input tax (by taxInvoiceDate), so the expense counts subtotalAmount instead of netAmount. */
  inputVatRecoverable: boolean;
  items: ExpenseLineState[];
  payments: ComparablePaymentRow[];
  whtLines: ExpenseWhtLine[];
};

/** `id` lets the non-financial path save a line's description (P4). */
export type StoredExpenseFinancialState = ExpenseFinancialState & { items: Array<ExpenseLineState & { id: string }> };

export const EXPENSE_PERIOD_LOCK_ALLOWED_EDITS_HINT =
  "แก้หมายเหตุ รายละเอียดของแต่ละรายการ และเลขที่/วันที่ใบกำกับภาษีได้โดยไม่ต้องปลดล็อก (ยกเว้นวันที่ใบกำกับภาษีที่ทำให้ VAT เปลี่ยนระหว่างต้นทุนกับภาษีซื้อ)";

const sameWhtLine = (a: ExpenseWhtLine, b: ExpenseWhtLine): boolean =>
  a.incomeTypeId === b.incomeTypeId &&
  sameMoney(a.baseAmount, b.baseAmount) &&
  sameMoney(a.rate, b.rate) &&
  sameMoney(a.taxAmount, b.taxAmount) &&
  a.payCondition === b.payCondition;

export function isExpenseNonFinancialChange(stored: ExpenseFinancialState, submitted: ExpenseFinancialState): boolean {
  return (
    getThailandDateKey(stored.expenseDate) === getThailandDateKey(submitted.expenseDate) &&
    sameOptional(stored.supplierId, submitted.supplierId) &&
    stored.vatType === submitted.vatType &&
    sameMoney(stored.vatRate, submitted.vatRate) &&
    stored.inputVatRecoverable === submitted.inputVatRecoverable &&
    stored.items.length === submitted.items.length &&
    stored.items.every((item, index) => {
      const next = submitted.items[index];
      // description is a remark (P4): not compared.
      return item.expenseCodeId === next.expenseCodeId && sameMoney(item.amount, next.amount);
    }) &&
    samePaymentRows(stored.payments, submitted.payments) &&
    stored.whtLines.length === submitted.whtLines.length &&
    stored.whtLines.every((line, index) => sameWhtLine(line, submitted.whtLines[index]))
  );
}

/**
 * The stored financial fields, read with the transaction client after the Expense row lock.
 * registeredFrom is the shop's VAT registration date (lib/input-vat.ts), or null while not registered.
 */
export async function loadExpenseFinancialState(
  tx: Prisma.TransactionClient,
  expenseId: string,
  registeredFrom: Date | null,
): Promise<StoredExpenseFinancialState | null> {
  try {
    const [expense, payments, certificate] = await Promise.all([
      tx.expense.findUnique({
        where: { id: expenseId },
        select: {
          expenseDate: true,
          supplierId: true,
          vatType: true,
          vatRate: true,
          taxInvoiceDate: true,
          items: {
            orderBy: [{ lineNo: "asc" }, { id: "asc" }],
            select: { id: true, expenseCodeId: true, description: true, amount: true },
          },
        },
      }),
      tx.documentPayment.findMany({
        where: { docType: "EXPENSE", docId: expenseId },
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: { cashBankAccountId: true, amount: true },
      }),
      tx.whtCertificate.findFirst({
        where: { activeExpenseId: expenseId, status: "ACTIVE" },
        select: {
          lines: {
            orderBy: { lineNo: "asc" },
            select: { incomeTypeId: true, baseAmount: true, rate: true, taxAmount: true, payCondition: true },
          },
        },
      }),
    ]);
    if (!expense) return null;
    const { taxInvoiceDate, ...state } = expense;
    const inputVatRecoverable = isInputVatRecoverable({ vatType: expense.vatType, vatRate: Number(expense.vatRate),
      taxDocumentDate: taxInvoiceDate, registeredFrom });
    return { ...state, inputVatRecoverable, payments, whtLines: certificate?.lines ?? [] };
  } catch (error) {
    throw new Error("Failed to load expense for the period lock check", { cause: error });
  }
}
