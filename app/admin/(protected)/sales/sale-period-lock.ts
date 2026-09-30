import type { Prisma } from "@/lib/generated/prisma";
import { sameMoney, sameOptional, samePaymentRows, type ComparablePaymentRow } from "@/lib/period-lock-document";
import { getThailandDateKey } from "@/lib/th-date";
import { isSaleLineUnchanged, type IncomingSaleLine, type StoredSaleLine } from "./sale-claim-lock";
import { comparableSaleCreditTerm } from "./sale-credit-term";

/**
 * Owner decisions ก2 / P4 for sales: in a month whose profit was already distributed these may
 * change without the override — note, customer display name / phone, delivery info (shipping
 * address and map pin) and each line's detail text (moreDetail, a remark). The customer itself
 * (customerId, which moves the receivable) may change only on a cash sale or a fully paid sale,
 * and never while a withholding-tax record names the current customer. Anything else — date,
 * lines, prices, discounts, VAT, shipping fee, payment type/channels, fulfillment type, carrier,
 * credit term (credit sales only — S9), quotation, marketplace order ref, WHT — is a financial
 * change and needs the override.
 */

type Amount = number | string | { toString(): string };

export type SaleWhtState = {
  incomeTypeId: string;
  baseAmount: Amount;
  rate: Amount;
  taxAmount: Amount;
  certNo: string | null;
  /** YYYY-MM-DD (Thailand) or null. */
  certDateKey: string | null;
};

export type SaleHeaderState = {
  saleDate: Date;
  customerId: string | null;
  saleType: string;
  paymentType: string;
  fulfillmentType: string;
  shippingMethod: string;
  shippingFee: Amount | null;
  discount: Amount;
  vatType: string;
  vatRate: Amount;
  creditTerm: number | null;
  channelRefNo: string | null;
  quotationId: string | null;
};

export type StoredSaleFinancialState = SaleHeaderState & {
  amountRemain: Amount;
  lines: StoredSaleLine[];
  payments: ComparablePaymentRow[];
  wht: SaleWhtState | null;
};

export type SubmittedSaleFinancialState = SaleHeaderState & {
  lines: IncomingSaleLine[];
  payments: ComparablePaymentRow[];
  wht: SaleWhtState | null;
};

export const SALE_PERIOD_LOCK_ALLOWED_EDITS_HINT =
  "แก้หมายเหตุ รายละเอียดเพิ่มเติมของแต่ละรายการ ชื่อ/เบอร์โทรลูกค้าบนเอกสาร และข้อมูลจัดส่ง (ที่อยู่ จุดส่ง) ได้โดยไม่ต้องปลดล็อก — เปลี่ยนลูกค้าได้เฉพาะใบขายสดหรือใบที่รับชำระครบแล้ว ส่วนวิธีรับสินค้าและประเภทขนส่งยังนับเป็นการแก้ตัวเลข";

const sameWht = (a: SaleWhtState | null, b: SaleWhtState | null): boolean => {
  if (!a || !b) return a === b;
  return (
    a.incomeTypeId === b.incomeTypeId &&
    sameMoney(a.baseAmount, b.baseAmount) &&
    sameMoney(a.rate, b.rate) &&
    sameMoney(a.taxAmount, b.taxAmount) &&
    sameOptional(a.certNo, b.certNo) &&
    sameOptional(a.certDateKey, b.certDateKey)
  );
};

/**
 * The receivable does not move when the customer changes: nothing is (or remains) owed. The edit
 * page asks too, so the form knows whether a customer change needs the override reason (P3).
 */
export function canChangeSaleCustomerInLockedPeriod(
  stored: Pick<StoredSaleFinancialState, "paymentType" | "amountRemain"> & { wht: object | null },
): boolean {
  const settled = stored.paymentType === "CASH_SALE" || sameMoney(stored.amountRemain, 0);
  return settled && stored.wht === null;
}

function sameSaleHeader(stored: SaleHeaderState, submitted: SaleHeaderState): boolean {
  return (
    getThailandDateKey(stored.saleDate) === getThailandDateKey(submitted.saleDate) &&
    stored.saleType === submitted.saleType &&
    stored.paymentType === submitted.paymentType &&
    stored.fulfillmentType === submitted.fulfillmentType &&
    stored.shippingMethod === submitted.shippingMethod &&
    sameMoney(stored.shippingFee, submitted.shippingFee) &&
    sameMoney(stored.discount, submitted.discount) &&
    stored.vatType === submitted.vatType &&
    sameMoney(stored.vatRate, submitted.vatRate) &&
    // S9: ignored on a cash sale (paymentType itself is compared above).
    comparableSaleCreditTerm(stored.paymentType, stored.creditTerm) ===
      comparableSaleCreditTerm(submitted.paymentType, submitted.creditTerm) &&
    sameOptional(stored.channelRefNo, submitted.channelRefNo) &&
    sameOptional(stored.quotationId, submitted.quotationId)
  );
}

/**
 * True when the submitted edit changes nothing but the fields allowed in a locked month.
 * `scaleOf` is the base-unit scale of a submitted line's unit.
 */
export function isSaleNonFinancialChange(
  stored: StoredSaleFinancialState,
  submitted: SubmittedSaleFinancialState,
  scaleOf: (line: IncomingSaleLine) => number,
): boolean {
  const customerChanged = !sameOptional(stored.customerId, submitted.customerId);
  if (customerChanged && !canChangeSaleCustomerInLockedPeriod(stored)) return false;
  return (
    sameSaleHeader(stored, submitted) &&
    stored.lines.length === submitted.lines.length &&
    stored.lines.every((line, index) => {
      const next = submitted.lines[index];
      // The line's detail text is a remark (P4): compared as if it came back unchanged.
      return isSaleLineUnchanged(line, { ...next, moreDetail: line.moreDetail ?? undefined }, scaleOf(next));
    }) &&
    samePaymentRows(stored.payments, submitted.payments) &&
    sameWht(stored.wht, submitted.wht)
  );
}

/** Payment rows and the WHT record of a sale, read with the transaction client under the Sale row lock. */
export async function loadSaleMoneyState(
  tx: Prisma.TransactionClient,
  saleId: string,
): Promise<{ payments: ComparablePaymentRow[]; wht: SaleWhtState | null }> {
  try {
    const [payments, wht] = await Promise.all([
      tx.documentPayment.findMany({
        where: { docType: "SALE", docId: saleId },
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: { cashBankAccountId: true, amount: true },
      }),
      tx.whtReceived.findFirst({
        where: { saleId, status: "ACTIVE" },
        select: { incomeTypeId: true, baseAmount: true, rate: true, taxAmount: true, certNo: true, certDate: true },
      }),
    ]);
    return {
      payments,
      wht: wht
        ? {
            incomeTypeId: wht.incomeTypeId,
            baseAmount: wht.baseAmount,
            rate: wht.rate,
            taxAmount: wht.taxAmount,
            certNo: wht.certNo,
            certDateKey: wht.certDate ? getThailandDateKey(wht.certDate) : null,
          }
        : null,
    };
  } catch (error) {
    throw new Error("Failed to load sale payments for the period lock check", { cause: error });
  }
}
