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
        findMany: async () => [{ receipt: { id: "receipt-1", receiptNo: "RC-001" } },
        ],
      },
      warrantyClaim: {
        findMany: async () => [{ id: "claim-1", claimNo: "WC-001" }],
      },
    });

    const result = await guard.check("Sale", "sale-1", "update");

    assert.equal(result.blocked, true);
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["CN-001", "RC-001", "WC-001"],
    );
  });

  it("blocks sale mutation after it is included in an active Shopee settlement", async () => {
    const guard = createDocumentMutationGuard({
      shopeeSettlementSale: {
        findMany: async () => [{ settlement: { id: "settlement-1", settlementNo: "SST26080001" } }],
      },
    });
    const result = await guard.check("Sale", "sale-1", "cancel");
    assert.equal(result.blocked, true);
    assert.deepEqual(result.references, [{ entityType: "ShopeeSettlement", id: "settlement-1", refNo: "SST26080001" }]);
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

    const purchaseReturnResult = await guard.check("PurchaseReturn", "return-1", "cancel",
    );
    const advanceResult = await guard.check("SupplierAdvance", "advance-1", "cancel",
    );

    assert.equal(purchaseReturnResult.blocked, true);
    assert.deepEqual(purchaseReturnResult.references.map((ref) => ref.refNo), ["SP-001"],
    );
    assert.equal(advanceResult.blocked, true);
    assert.deepEqual(advanceResult.references.map((ref) => ref.refNo), ["SP-001"],
    );
  });

  it("blocks customer advance mutation when an active receipt uses it", async () => {
    const guard = createDocumentMutationGuard({
      receiptItem: {
        findMany: async () => [
          { receipt: { id: "receipt-1", receiptNo: "REC-001" } },
          { receipt: { id: "receipt-1", receiptNo: "REC-001" } },
        ],
      },
    });

    const result = await guard.check("CustomerAdvance", "advance-1", "cancel");

    assert.equal(result.blocked, true);
    assert.equal(result.reason, "ถูกนำไปใช้ที่ใบเสร็จรับเงิน");
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["REC-001"],
    );
  });

  it("blocks source cancellation when an active advance refund references it", async () => {
    const guard = createDocumentMutationGuard({
      customerAdvanceRefund: {
        findMany: async () => [{ id: "refund-1", refundNo: "CNSD26080001" }],
      },
      supplierAdvanceRefund: {
        findMany: async () => [{ id: "refund-2", refundNo: "CNADV26080001" }],
      },
    });

    const customerResult = await guard.check(
      "CustomerAdvance",
      "advance-1",
      "cancel",
    );
    const supplierResult = await guard.check(
      "SupplierAdvance",
      "advance-2",
      "cancel",
    );

    assert.equal(customerResult.blocked, true);
    assert.deepEqual(
      customerResult.references.map((ref) => ref.refNo),
      ["CNSD26080001"],
    );
    assert.equal(supplierResult.blocked, true);
    assert.deepEqual(
      supplierResult.references.map((ref) => ref.refNo),
      ["CNADV26080001"],
    );
  });

  it("does not treat an advance refund as an update blocker because source updates become note-only", async () => {
    const guard = createDocumentMutationGuard({
      customerAdvanceRefund: {
        findMany: async () => {
          throw new Error("refund lookup must only run for cancellation");
        },
      },
    });

    const result = await guard.check("CustomerAdvance", "advance-1", "update");

    assert.equal(result.blocked, false);
    assert.deepEqual(result.references, []);
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
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["PR-001", "PR-002"],
    );
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
