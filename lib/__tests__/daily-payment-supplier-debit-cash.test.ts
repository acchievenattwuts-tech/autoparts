import assert from "node:assert/strict";
import test from "node:test";

import { calculateSupplierPaymentCashOut } from "../report-queries";

// Daily payment report / LINE daily summary: a supplier payment line settling a
// Supplier Debit Note is real cash out, exactly like a purchase line. It used to
// be treated as an offset credit and subtracted.

const line = (paidAmount: number, ref: { purchaseId?: string; debitNoteId?: string } = {}) => ({
  paidAmount,
  purchaseId: ref.purchaseId ?? null,
  debitNoteId: ref.debitNoteId ?? null,
});

test("a DN-only supplier payment counts its full amount as cash out", () => {
  assert.equal(calculateSupplierPaymentCashOut([line(500, { debitNoteId: "dn-1" })]), 500);
});

test("purchase 1,000 plus DN 500 in one payment is 1,500 cash out", () => {
  assert.equal(
    calculateSupplierPaymentCashOut([line(1000, { purchaseId: "pu-1" }), line(500, { debitNoteId: "dn-1" })]),
    1500,
  );
});

test("purchase 1,000 offset by a 300 return credit is still 700 cash out", () => {
  assert.equal(calculateSupplierPaymentCashOut([line(1000, { purchaseId: "pu-1" }), line(300)]), 700);
});

test("DN 500 offset by a 200 advance credit is 300 cash out", () => {
  assert.equal(calculateSupplierPaymentCashOut([line(500, { debitNoteId: "dn-1" }), line(200)]), 300);
});
