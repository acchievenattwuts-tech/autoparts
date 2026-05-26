import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPurchaseDraft,
  getPurchaseDraftKey,
  parsePurchaseDraft,
  sanitizePurchaseItemsForSubmit,
} from "../purchase-form-data";

test("sanitizePurchaseItemsForSubmit clamps negative landed cost from existing purchases", () => {
  const items = [
    {
      productId: "p1",
      unitName: "กล่อง",
      qty: 2,
      costPrice: 390,
      landedCost: -156,
      lotItems: [],
    },
  ];

  const [item] = sanitizePurchaseItemsForSubmit(items);

  assert.equal(item.landedCost, 0);
  assert.equal(item.qty, 2);
  assert.equal(item.costPrice, 390);
});

test("getPurchaseDraftKey scopes new and edit purchase drafts separately", () => {
  assert.equal(getPurchaseDraftKey({ mode: "new" }), "purchase-draft:new");
  assert.equal(
    getPurchaseDraftKey({ mode: "edit", purchaseId: "abc123" }),
    "purchase-draft:edit:abc123",
  );
});

test("parsePurchaseDraft rejects drafts from the wrong context", () => {
  const draft = buildPurchaseDraft({
    mode: "edit",
    purchaseId: "abc123",
    purchaseDate: "2026-05-26",
    supplierId: "supplier-1",
    purchaseType: "CASH_PURCHASE",
    cashBankAccountId: "cash-1",
    referenceNo: "ref-1",
    discount: 10,
    shippingFee: 5,
    note: "draft note",
    vatType: "NO_VAT",
    vatRate: 0,
    creditTerm: "",
    items: [],
  });

  assert.equal(
    parsePurchaseDraft(JSON.stringify(draft), { mode: "edit", purchaseId: "other" }),
    null,
  );
});
