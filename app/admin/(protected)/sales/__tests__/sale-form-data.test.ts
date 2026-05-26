import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSaleDraft,
  getSaleDraftKey,
  parseSaleDraft,
  type SaleDraftPayload,
} from "../sale-form-data";

const sampleDraft = (): SaleDraftPayload =>
  buildSaleDraft({
    mode: "edit",
    saleId: "sale-1",
    saleDate: "2026-05-26",
    customerId: "customer-1",
    customerName: "Customer",
    customerPhone: "0812345678",
    saleType: "RETAIL",
    paymentType: "CASH_SALE",
    cashBankAccountId: "cash-1",
    fulfillmentType: "PICKUP",
    shippingAddress: "",
    shippingFee: 0,
    shippingMethod: "NONE",
    destLatitude: null,
    destLongitude: null,
    discount: 0,
    note: "",
    vatType: "NO_VAT",
    vatRate: 0,
    creditTerm: 0,
    items: [],
  });

test("getSaleDraftKey scopes new and edit drafts separately", () => {
  assert.equal(getSaleDraftKey({ mode: "new" }), "sale-draft:new");
  assert.equal(
    getSaleDraftKey({ mode: "edit", saleId: "sale-1" }),
    "sale-draft:edit:sale-1",
  );
});

test("parseSaleDraft rejects drafts from another form context", () => {
  const raw = JSON.stringify(sampleDraft());

  assert.equal(parseSaleDraft(raw, { mode: "new" }), null);
  assert.equal(parseSaleDraft(raw, { mode: "edit", saleId: "sale-2" }), null);
  assert.equal(parseSaleDraft(raw, { mode: "edit", saleId: "sale-1" })?.saleId, "sale-1");
});
