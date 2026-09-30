import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseDateOnlyToDate } from "@/lib/th-date";
import {
  canChangeSaleCustomerInLockedPeriod,
  isSaleNonFinancialChange,
  type StoredSaleFinancialState,
  type SubmittedSaleFinancialState,
} from "../sale-period-lock";
import { comparableSaleCreditTerm } from "../sale-credit-term";

// Owner decisions ก2 / P4 for sales in a month whose profit was already distributed: only the note,
// customer display name/phone, delivery info and line detail text are free; the customer itself
// only moves on a cash sale or a fully paid one (the receivable does not move), never while a WHT
// record names it. Fulfilment type and carrier stay financial.

const stored = (overrides: Partial<StoredSaleFinancialState> = {}): StoredSaleFinancialState => ({
  saleDate: parseDateOnlyToDate("2026-08-20"),
  customerId: "cust-1",
  saleType: "RETAIL",
  paymentType: "CASH_SALE",
  fulfillmentType: "DELIVERY",
  shippingMethod: "KERRY",
  shippingFee: "50.00",
  discount: "0.00",
  vatType: "NO_VAT",
  vatRate: "0.00",
  creditTerm: null,
  channelRefNo: null,
  quotationId: null,
  amountRemain: "0.00",
  lines: [
    {
      productId: "p-1",
      quantity: 12,
      showQty: 1,
      showUnitName: "โหล",
      salePrice: 1200,
      unitListPrice: 1200,
      warrantyDays: 30,
      supplierId: null,
      supplierName: null,
      moreDetail: null,
      lots: [],
    },
  ],
  payments: [{ cashBankAccountId: "cash-1", amount: "1250.00" }],
  wht: null,
  ...overrides,
});

const submitted = (overrides: Partial<SubmittedSaleFinancialState> = {}): SubmittedSaleFinancialState => ({
  saleDate: parseDateOnlyToDate("2026-08-20"),
  customerId: "cust-1",
  saleType: "RETAIL",
  paymentType: "CASH_SALE",
  fulfillmentType: "DELIVERY",
  shippingMethod: "KERRY",
  shippingFee: 50,
  discount: 0,
  vatType: "NO_VAT",
  vatRate: 0,
  creditTerm: 0,
  channelRefNo: null,
  quotationId: null,
  lines: [
    { productId: "p-1", unitName: "โหล", qty: 1, salePrice: 1200, unitListPrice: 1200, warrantyDays: 30, lotItems: [] },
  ],
  payments: [{ cashBankAccountId: "cash-1", amount: 1250 }],
  wht: null,
  ...overrides,
});

const DOZEN = () => 12;

test("an unchanged form (note / name / phone / address are not compared) is non-financial", () => {
  assert.equal(isSaleNonFinancialChange(stored(), submitted(), DOZEN), true);
});

test("customer change: allowed on a cash sale and on a fully paid credit sale", () => {
  assert.equal(isSaleNonFinancialChange(stored(), submitted({ customerId: "cust-2" }), DOZEN), true);
  const paidCredit = stored({ paymentType: "CREDIT_SALE", amountRemain: "0.00", payments: [], creditTerm: 30 });
  assert.equal(
    isSaleNonFinancialChange(
      paidCredit,
      submitted({ customerId: "cust-2", paymentType: "CREDIT_SALE", payments: [], creditTerm: 30 }),
      DOZEN,
    ),
    true,
  );
});

// Owner decision S9: picking another customer on a cash sale also loads that customer's credit term.
test("customer change on a cash sale: a different credit term is ignored (server and form hint agree)", () => {
  for (const creditTerm of [30, 0, null]) {
    assert.equal(
      isSaleNonFinancialChange(stored({ creditTerm: 15 }), submitted({ customerId: "cust-2", creditTerm }), DOZEN),
      true,
      String(creditTerm),
    );
  }
  // Same customer, only the term moved: a cash sale still owes nothing.
  assert.equal(isSaleNonFinancialChange(stored(), submitted({ creditTerm: 45 }), DOZEN), true);
  // The edit form's reason hint compares the same value.
  assert.equal(comparableSaleCreditTerm("CASH_SALE", 30), null);
  assert.equal(comparableSaleCreditTerm("CASH_SALE", null), null);
  assert.equal(comparableSaleCreditTerm("CREDIT_SALE", 30), 30);
  assert.equal(comparableSaleCreditTerm("CREDIT_SALE", null), 0);
  const formSource = readFileSync(join(process.cwd(), "app/admin/(protected)/sales/new/SaleForm.tsx"), "utf8");
  assert.match(formSource, /creditTerm: comparableSaleCreditTerm\(paymentType, creditTerm\),/);
});

test("credit sales keep comparing the credit term, and a cash/credit switch stays financial", () => {
  const paidCredit = stored({ paymentType: "CREDIT_SALE", amountRemain: "0.00", payments: [], creditTerm: 30 });
  const creditEdit = (overrides: Partial<SubmittedSaleFinancialState>) =>
    submitted({ paymentType: "CREDIT_SALE", payments: [], creditTerm: 30, ...overrides });
  assert.equal(isSaleNonFinancialChange(paidCredit, creditEdit({ customerId: "cust-2", creditTerm: 45 }), DOZEN), false);
  assert.equal(isSaleNonFinancialChange(paidCredit, creditEdit({ creditTerm: 0 }), DOZEN), false);
  assert.equal(isSaleNonFinancialChange(paidCredit, creditEdit({ creditTerm: null }), DOZEN), false);
  assert.equal(isSaleNonFinancialChange(stored({ creditTerm: 30 }), submitted({ paymentType: "CREDIT_SALE", payments: [], creditTerm: 30 }), DOZEN), false);
});

test("customer change: blocked on an unpaid credit sale and while a WHT record names the customer", () => {
  const unpaidCredit = stored({ paymentType: "CREDIT_SALE", amountRemain: "1250.00", payments: [], creditTerm: 30 });
  assert.equal(canChangeSaleCustomerInLockedPeriod(unpaidCredit), false);
  assert.equal(
    isSaleNonFinancialChange(
      unpaidCredit,
      submitted({ customerId: "cust-2", paymentType: "CREDIT_SALE", payments: [], creditTerm: 30 }),
      DOZEN,
    ),
    false,
  );
  // Same customer on the unpaid credit sale: still a note-only edit.
  assert.equal(
    isSaleNonFinancialChange(
      unpaidCredit,
      submitted({ paymentType: "CREDIT_SALE", payments: [], creditTerm: 30 }),
      DOZEN,
    ),
    true,
  );
  const wht = { incomeTypeId: "it-1", baseAmount: "1250.00", rate: "3.00", taxAmount: "37.50", certNo: null, certDateKey: null };
  assert.equal(canChangeSaleCustomerInLockedPeriod(stored({ wht })), false);
});

test("line detail text is a remark (P4): changing it alone stays non-financial", () => {
  const withDetail = submitted({
    lines: [{ productId: "p-1", unitName: "โหล", qty: 1, salePrice: 1200, unitListPrice: 1200, warrantyDays: 30, moreDetail: "แถม", lotItems: [] }],
  });
  assert.equal(isSaleNonFinancialChange(stored(), withDetail, DOZEN), true);
  // ...but not when the same line's price moves with it.
  const withDetailAndPrice = submitted({
    lines: [{ productId: "p-1", unitName: "โหล", qty: 1, salePrice: 1100, unitListPrice: 1200, warrantyDays: 30, moreDetail: "แถม", lotItems: [] }],
  });
  assert.equal(isSaleNonFinancialChange(stored(), withDetailAndPrice, DOZEN), false);
});

test("any money, stock or date field is financial", () => {
  const cases: Array<Partial<SubmittedSaleFinancialState>> = [
    { saleDate: parseDateOnlyToDate("2026-09-01") },
    { discount: 10 },
    { shippingFee: 60 },
    { vatType: "INCLUDING_VAT", vatRate: 7 },
    { paymentType: "CREDIT_SALE" },
    { fulfillmentType: "PICKUP" },
    { shippingMethod: "FLASH" },
    { payments: [{ cashBankAccountId: "bank-1", amount: 1250 }] },
    { quotationId: "sq-1" },
    { lines: [{ productId: "p-1", unitName: "โหล", qty: 1, salePrice: 1100, unitListPrice: 1200, warrantyDays: 30, lotItems: [] }] },
    { lines: [{ productId: "p-1", unitName: "โหล", qty: 2, salePrice: 1200, unitListPrice: 1200, warrantyDays: 30, lotItems: [] }] },
    { wht: { incomeTypeId: "it-1", baseAmount: 1250, rate: 3, taxAmount: 37.5, certNo: null, certDateKey: null } },
  ];
  for (const change of cases) {
    assert.equal(isSaleNonFinancialChange(stored(), submitted(change), DOZEN), false, JSON.stringify(change));
  }
});
