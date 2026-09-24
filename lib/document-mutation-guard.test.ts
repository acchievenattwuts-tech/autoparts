import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MARKETPLACE_SETTLEMENT_SOURCE_REASON,
  buildMutationBlockMessage,
  buildMutationBlockReferenceLinks,
  buildMutationBlockResult,
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

    const result = await guard.check("Sale", "sale-1", "cancel");

    assert.equal(result.blocked, true);
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["CN-001", "RC-001", "WC-001"],
    );
  });

  it("does not let warranty claims block a sale edit (claimed lines are locked instead)", async () => {
    const claimQueries: unknown[] = [];
    const guard = createDocumentMutationGuard({
      creditNote: { findMany: async () => [{ id: "cn-1", cnNo: "CN-001" }] },
      warrantyClaim: {
        findMany: async (args) => {
          claimQueries.push(args);
          return [{ id: "claim-1", claimNo: "WC26090001" }];
        },
      },
    });

    const result = await guard.check("Sale", "sale-1", "update");

    assert.deepEqual(claimQueries, [], "claims are not even queried for an edit");
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["CN-001"]);
  });

  it("blocks a sale cancel on ANY claim of its warranties, whatever the claim status, listing the numbers", async () => {
    const claimQueries: Array<Record<string, unknown>> = [];
    const guard = createDocumentMutationGuard({
      warrantyClaim: {
        findMany: async (args) => {
          claimQueries.push(args);
          return [
            { id: "claim-1", claimNo: "WC26090001" },
            { id: "claim-2", claimNo: "WCM26090003" },
          ];
        },
      },
    });

    const result = await guard.check("Sale", "sale-1", "cancel");

    assert.deepEqual(claimQueries[0]?.where, { warranty: { saleId: "sale-1" } }, "no status filter");
    assert.equal(result.blocked, true);
    assert.equal(
      buildMutationBlockMessage(result),
      "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่เอกสารปลายทาง: WC26090001, WCM26090003",
    );
  });

  it("blocks sale mutation after it is included in an active marketplace settlement", async () => {
    const guard = createDocumentMutationGuard({
      marketplaceSettlementLine: {
        findMany: async () => [{ settlement: { id: "settlement-1", settlementNo: "LZS26080001" } }],
      },
    });
    const result = await guard.check("Sale", "sale-1", "cancel");
    assert.equal(result.blocked, true);
    assert.deepEqual(result.references, [
      { entityType: "MarketplaceSettlement", id: "settlement-1", refNo: "LZS26080001" },
    ]);
  });

  it("allows sale updates before marketplace settlement", async () => {
    const guard = createDocumentMutationGuard({
      marketplaceSettlementLine: {
        findMany: async () => [],
      },
    });

    const result = await guard.check("Sale", "sale-1", "update");

    assert.equal(result.blocked, false);
    assert.deepEqual(result.references, []);
  });

  it("blocks credit note cancellation after it is deducted in an active settlement", async () => {
    const guard = createDocumentMutationGuard({
      marketplaceSettlementLine: {
        findMany: async () => [{ settlement: { id: "settlement-2", settlementNo: "LZS26080002" } }],
      },
    });
    const result = await guard.check("CreditNote", "cn-1", "cancel");
    assert.equal(result.blocked, true);
    assert.deepEqual(result.references, [
      { entityType: "MarketplaceSettlement", id: "settlement-2", refNo: "LZS26080002" },
    ]);
  });

  it("blocks marketplace return cancellation while its carrier expense is active", async () => {
    const guard = createDocumentMutationGuard({
      expense: {
        findMany: async () => [{ id: "expense-return-1", expenseNo: "OE26090001" }],
      },
    });
    const result = await guard.check("CreditNote", "cn-return-1", "cancel");
    assert.equal(result.blocked, true);
    assert.deepEqual(result.references, [
      { entityType: "Expense", id: "expense-return-1", refNo: "OE26090001" },
    ]);
  });

  it("blocks cancelling the fee expense a settlement created", async () => {
    const guard = createDocumentMutationGuard({
      marketplaceSettlement: {
        findMany: async () => [{ id: "settlement-3", settlementNo: "LZS26080003" }],
      },
    });
    const result = await guard.check("Expense", "expense-1", "cancel");
    assert.equal(result.blocked, true);
    assert.deepEqual(result.references, [
      { entityType: "MarketplaceSettlement", id: "settlement-3", refNo: "LZS26080003" },
    ]);
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

  it("blocks sale cancel/update while the bill is in an active delivery commission run", async () => {
    const queries: unknown[] = [];
    const guard = createDocumentMutationGuard({
      deliveryCommissionItem: {
        findMany: async (args) => {
          queries.push(args);
          return [{ run: { id: "run-1", runNo: "DCP26090001" } }];
        },
      },
    });

    for (const action of ["cancel", "update"] as const) {
      const result = await guard.check("Sale", "sale-1", action);
      assert.equal(result.blocked, true);
      assert.deepEqual(result.references, [
        { entityType: "DeliveryCommissionRun", id: "run-1", refNo: "DCP26090001" },
      ]);
      assert.equal(
        buildMutationBlockMessage(result),
        "ไม่สามารถดำเนินการได้ เนื่องจากบิลนี้ถูกทำจ่ายค่าส่งแล้ว กรุณายกเลิกเอกสารทำจ่ายก่อน: DCP26090001",
      );
      assert.deepEqual(buildMutationBlockReferenceLinks(result), [
        { href: "/admin/delivery-commissions/run-1", label: "DCP26090001" },
      ]);
    }
    // Only runs that still hold the bill (activeSaleId) and are ACTIVE count.
    assert.deepEqual((queries[0] as { where: unknown }).where, {
      activeSaleId: "sale-1",
      run: { status: "ACTIVE" },
    });
  });

  it("keeps the generic reason when a sale is also used by other downstream documents", async () => {
    const guard = createDocumentMutationGuard({
      creditNote: { findMany: async () => [{ id: "cn-1", cnNo: "CN-001" }] },
      deliveryCommissionItem: { findMany: async () => [{ run: { id: "run-1", runNo: "DCP26090001" } }] },
    });
    const result = await guard.check("Sale", "sale-1", "cancel");
    assert.equal(result.reason, "ถูกนำไปใช้ที่เอกสารปลายทาง");
    assert.deepEqual(result.references.map((ref) => ref.refNo), ["CN-001", "DCP26090001"]);
  });

  it("allows sale mutation once the delivery commission run is cancelled", async () => {
    const guard = createDocumentMutationGuard({ deliveryCommissionItem: { findMany: async () => [] } });
    const result = await guard.check("Sale", "sale-1", "cancel");
    assert.equal(result.blocked, false);
  });

  it("blocks expense cancel/update when an active delivery commission run created it", async () => {
    const queries: unknown[] = [];
    const guard = createDocumentMutationGuard({
      marketplaceSettlement: { findMany: async () => [] },
      deliveryCommissionRun: {
        findMany: async (args) => {
          queries.push(args);
          return [{ id: "run-2", runNo: "DCP26090002" }];
        },
      },
    });
    for (const action of ["cancel", "update"] as const) {
      const result = await guard.check("Expense", "expense-2", action);
      assert.equal(
        buildMutationBlockMessage(result),
        "ไม่สามารถดำเนินการได้ เนื่องจากถูกสร้างจากเอกสารทำจ่ายค่าส่ง กรุณายกเลิกที่เอกสารทำจ่ายแทน: DCP26090002",
      );
    }
    assert.deepEqual((queries[0] as { where: unknown }).where, { expenseId: "expense-2", status: "ACTIVE" });
  });

  it("leaves ordinary expenses and cash/bank documents free of the delivery-commission check", async () => {
    let runQueries = 0;
    const guard = createDocumentMutationGuard({
      marketplaceSettlement: { findMany: async () => [] },
      deliveryCommissionRun: {
        findMany: async () => {
          runQueries += 1;
          return [];
        },
      },
    });
    assert.equal((await guard.check("Expense", "expense-3", "cancel")).blocked, false);
    assert.equal((await guard.check("CashBankAdjustment", "adj-1", "update")).blocked, false);
    assert.equal((await guard.check("CashBankTransfer", "tr-1", "cancel")).blocked, false);
    assert.equal(runQueries, 1, "only the Expense check looks at delivery commission runs");
  });

  it("blocks updating a cash/bank adjustment created by an active marketplace settlement", async () => {
    const guard = createDocumentMutationGuard({
      marketplaceSettlement: { findMany: async () => [{ id: "settlement-9", settlementNo: "SPS26090009" }] },
    });
    const result = await guard.check("CashBankAdjustment", "adj-9", "update");
    assert.equal(result.blocked, true);
    assert.equal(
      buildMutationBlockMessage(result),
      "ไม่สามารถดำเนินการได้ เนื่องจากถูกสร้างจากรอบรับเงินช่องทางขาย กรุณายกเลิกที่รอบรับเงินแทน: SPS26090009",
    );
  });

  it("builds the same message from relation data a list page already loaded", () => {
    assert.equal(
      buildMutationBlockMessage(
        buildMutationBlockResult(MARKETPLACE_SETTLEMENT_SOURCE_REASON, [
          { entityType: "MarketplaceSettlement", id: "settlement-9", refNo: "SPS26090009" },
        ]),
      ),
      "ไม่สามารถดำเนินการได้ เนื่องจากถูกสร้างจากรอบรับเงินช่องทางขาย กรุณายกเลิกที่รอบรับเงินแทน: SPS26090009",
    );
    assert.equal(buildMutationBlockResult(MARKETPLACE_SETTLEMENT_SOURCE_REASON, []).blocked, false);
  });
});
