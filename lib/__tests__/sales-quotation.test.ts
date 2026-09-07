import assert from "node:assert/strict";
import { test } from "node:test";
import { quotationSchema, quotationTotals, quotationFingerprint, formatQuotationReference } from "../sales-quotation-form";
import { createDocumentMutationGuard } from "../document-mutation-guard";

const input = { quotationDate: "2026-09-07", customerId: "c1", customerName: "ลูกค้า", creditTerm: 30, discount: 50, vatType: "INCLUDING_VAT", vatRate: 7, items: [{ productId: "p1", unitName: "ชิ้น", qty: 2, salePrice: 535, unitListPrice: 600 }] };
test("quotation validates dates and computes discounted VAT using sales semantics", () => {
  const data = quotationSchema.parse(input);
  assert.deepEqual(quotationTotals(data), { totalAmount: 1070, subtotalAmount: 953.27, vatAmount: 66.73, netAmount: 1020 });
  assert.equal(quotationSchema.safeParse({ ...input, quotationDate: "2026-02-30" }).success, false);
  assert.equal(quotationSchema.safeParse({ ...input, creditTerm: -1 }).success, false);
  assert.equal(quotationSchema.safeParse({ ...input, items: [] }).success, false);
});
test("zero selling prices remain valid; fractional quantity is retained", () => {
  const data = quotationSchema.parse({ ...input, discount: 0, items: [{ ...input.items[0], qty: 0.25, salePrice: 0 }] });
  assert.equal(data.items[0].qty, 0.25);
  assert.equal(quotationTotals(data).netAmount, 0);
});
test("revision fingerprints ignore object key order and detect actual document changes", () => {
  const data = quotationSchema.parse(input);
  assert.equal(quotationFingerprint(data), quotationFingerprint({ ...data, items: data.items.map((row) => ({ ...row, priceListId: null, pricePromotionId: null })) }));
  assert.notEqual(quotationFingerprint(data), quotationFingerprint({ ...data, note: "แก้หมายเหตุ" }));
  assert.notEqual(quotationFingerprint(data), quotationFingerprint({ ...data, items: [{ ...data.items[0], salePrice: 500 }] }));
  assert.equal(formatQuotationReference("SQ26090001", 0), "SQ26090001");
  assert.equal(formatQuotationReference("SQ26090001", 1), "SQ26090001 Rev.01");
  assert.equal(formatQuotationReference("SQ26090001", 100), "SQ26090001 Rev.100");
});
test("SQ guards all mutations and unlocks after detachment/cancellation", async () => {
  let linked = true;
  const guard = createDocumentMutationGuard({ sale: { findMany: async (args) => {
    assert.deepEqual(args.where, { activeQuotationId: "sq1", status: "ACTIVE" });
    return linked ? [{ id: "sale1", saleNo: "SA26090001" }] : [];
  } } });
  for (const action of ["update", "cancel", "reopen"] as const) {
    const result = await guard.check("SalesQuotation", "sq1", action);
    assert.equal(result.blocked, true);
    assert.equal(result.references[0].refNo, "SA26090001");
  }
  linked = false;
  assert.equal((await guard.check("SalesQuotation", "sq1", "update")).blocked, false);
});
