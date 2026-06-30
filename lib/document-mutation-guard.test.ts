import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMutationBlockMessage,
  createDocumentMutationGuard,
} from "./document-mutation-guard";

describe("document mutation guard", () => {
  it("blocks sale mutation when active downstream documents use it", async () => {
    const guard = createDocumentMutationGuard({
      creditNote: {
        findMany: async () => [{ id: "cn-1", cnNo: "CN-001" }],
      },
      receiptItem: {
        findMany: async () => [{ receipt: { id: "receipt-1", receiptNo: "RC-001" } }],
      },
      warrantyClaim: {
        findMany: async () => [{ id: "claim-1", claimNo: "WC-001" }],
      },
    });

    const result = await guard.check("Sale", "sale-1", "update");

    assert.equal(result.blocked, true);
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["CN-001", "RC-001", "WC-001"]);
  });

  it("deduplicates supplier payment refs for purchase return and supplier advance", async () => {
    const guard = createDocumentMutationGuard({
      supplierPaymentItem: {
        findMany: async () => [
          { payment: { id: "payment-1", paymentNo: "SP-001" } },
          { payment: { id: "payment-1", paymentNo: "SP-001" } },
        ],
      },
    });

    const purchaseReturnResult = await guard.check("PurchaseReturn", "return-1", "cancel");
    const advanceResult = await guard.check("SupplierAdvance", "advance-1", "cancel");

    assert.equal(purchaseReturnResult.blocked, true);
    assert.deepEqual(purchaseReturnResult.references.map((ref) => ref.refNo), ["SP-001"]);
    assert.equal(advanceResult.blocked, true);
    assert.deepEqual(advanceResult.references.map((ref) => ref.refNo), ["SP-001"]);
  });

  it("blocks warranty claim cancellation when an active purchase return uses it", async () => {
    const guard = createDocumentMutationGuard({
      purchaseReturn: {
        findMany: async () => [
          { id: "return-1", returnNo: "PR-001" },
          { id: "return-2", returnNo: "PR-002" },
        ],
      },
    });

    const result = await guard.check("WarrantyClaim", "claim-1", "cancel");

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "ถูกนำไปใช้ที่ใบลดหนี้ซื้อ");
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["PR-001", "PR-002"]);
  });

  it("allows warranty claim cancellation when no active downstream document exists", async () => {
    const guard = createDocumentMutationGuard({
      purchaseReturn: {
        findMany: async () => [],
      },
    });

    const result = await guard.check("WarrantyClaim", "claim-1", "cancel");

    assert.equal(result.blocked, false);
    assert.deepEqual(result.references, []);
  });

  it("formats a user-facing block message with downstream document numbers", () => {
    assert.equal(
      buildMutationBlockMessage({
        blocked: true,
        reason: "ถูกนำไปใช้ที่ใบลดหนี้ซื้อ",
        references: [
          { entityType: "PurchaseReturn", id: "return-1", refNo: "PR-001" },
          { entityType: "PurchaseReturn", id: "return-2", refNo: "PR-002" },
        ],
      }),
      "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่ใบลดหนี้ซื้อ: PR-001, PR-002",
    );
  });
});
