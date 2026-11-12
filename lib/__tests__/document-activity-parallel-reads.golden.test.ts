import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";

/**
 * Golden check for the document timeline after its independent reads were moved to Promise.all:
 * for every document type whose helper changed, the timeline (events, their content and their
 * order) must equal what the sequential code produced. EXPECTED was captured from the
 * sequential version on this fixture (GOLDEN_CAPTURE=1 prints it). Each fake query resolves
 * after a delay taken from a schedule, and the timeline is built under two opposite schedules,
 * so the result cannot depend on which query finishes first.
 */

const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 1, 3, minute));
const money = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

type Schedule = "ascending" | "descending";
let schedule: Schedule = "ascending";
let callIndex = 0;
const DELAY_STEP_MS = 2;
const MAX_CALLS = 12;

const delayed = async <T>(value: T): Promise<T> => {
  const index = callIndex;
  callIndex += 1;
  const slot = schedule === "ascending" ? index : MAX_CALLS - index;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, slot) * DELAY_STEP_MS));
  return value;
};

type Where = Record<string, unknown>;

const fakeDb = {
  auditLog: {
    findMany: ({ where }: { where: Where }) =>
      delayed([
        { id: `audit-create-${String(where.entityId)}`, action: "CREATE", createdAt: at(0), userName: "admin", entityType: where.entityType, entityId: where.entityId, entityRef: "DOC-1", meta: null },
        { id: `audit-update-${String(where.entityId)}`, action: "UPDATE", createdAt: at(5), userName: "staff", entityType: where.entityType, entityId: where.entityId, entityRef: "DOC-1", meta: null },
      ]),
  },
  receiptItem: {
    findMany: ({ where }: { where: Where }) => {
      if ("saleId" in where || "cnId" in where) {
        return delayed([
          { paidAmount: money(100), receipt: { id: "rc-1", receiptNo: "RC001", receiptDate: at(10), createdAt: at(10) } },
          { paidAmount: money(50), receipt: { id: "rc-2", receiptNo: "RC002", receiptDate: at(5), createdAt: at(5) } },
        ]);
      }
      return delayed([
        { paidAmount: money(70), sale: { id: "sa-1", saleNo: "SA001", saleDate: at(1), createdAt: at(1) }, creditNote: null, customerAdvance: null },
      ]);
    },
  },
  creditNote: {
    findMany: () => delayed([{ id: "cn-1", cnNo: "CN001", cnDate: at(10), createdAt: at(10), totalAmount: money(30) }]),
    findUnique: () => delayed({ sale: { id: "sa-1", saleNo: "SA001", saleDate: at(1), createdAt: at(1) } }),
  },
  warrantyClaim: {
    findMany: () => delayed([{ id: "wc-1", claimNo: "WC001", claimDate: at(7), createdAt: at(7) }]),
  },
  marketplaceSettlementLine: {
    findMany: () =>
      delayed([{ amount: money(90), settlement: { id: "ms-1", settlementNo: "MS001", settlementDate: at(5), createdAt: at(5) } }]),
  },
  deliveryCommissionItem: {
    findMany: () => delayed([{ commissionAmount: money(20), run: { id: "dc-1", runNo: "DC001", payDate: at(12), createdAt: at(12) } }]),
  },
  sale: {
    findUnique: () => delayed({ createdAt: at(0), quotation: { id: "qt-1", quotationNo: "QT001" } }),
  },
  purchaseReturn: {
    findMany: () => delayed([{ id: "pr-1", returnNo: "PR001", returnDate: at(8), createdAt: at(8), totalAmount: money(40) }]),
    findUnique: () => delayed({ returnNo: "PR001", purchase: { id: "po-1", purchaseNo: "PO001", purchaseDate: at(1), createdAt: at(1) } }),
  },
  supplierPaymentItem: {
    findMany: ({ where }: { where: Where }) => {
      if ("debitNoteId" in where) {
        return delayed([{ paidAmount: money(60), payment: { id: "sp-3", paymentNo: "SP003", createdAt: at(9) } }]);
      }
      return delayed([
        { paidAmount: money(60), payment: { id: "sp-1", paymentNo: "SP001", paymentDate: at(8), createdAt: at(8) } },
        { paidAmount: money(10), payment: { id: "sp-2", paymentNo: "SP002", paymentDate: at(3), createdAt: at(3) } },
      ]);
    },
  },
  supplierDebitNote: {
    findMany: ({ where }: { where: Where }) =>
      "adjustsDebitNoteId" in where
        ? delayed([{ id: "dn-adj", debitNo: "DN-ADJ", createdAt: at(8), netAmount: money(-15) }])
        : delayed([{ id: "dn-1", debitNo: "DN001", createdAt: at(8), netAmount: money(25) }]),
    findUnique: () =>
      delayed({
        netAmount: money(-15),
        cashBankAccount: { name: "KBank" },
        purchase: { id: "po-1", purchaseNo: "PO001", createdAt: at(1) },
        adjustsDebitNote: { id: "dn-1", debitNo: "DN001", createdAt: at(2) },
      }),
  },
  documentPayment: {
    findMany: () => delayed([{ id: "dp-1", amount: money(15), createdAt: at(8) }]),
  },
  expense: {
    findMany: () =>
      delayed([
        { id: "ex-1", expenseNo: "EX001", expenseDate: at(11), createdAt: at(11), netAmount: money(35), status: "ACTIVE" },
        { id: "ex-2", expenseNo: "EX002", expenseDate: at(11), createdAt: at(11), netAmount: money(5), status: "CANCELLED" },
      ]),
  },
  warranty: {
    findMany: () => delayed([{ cancelledAt: at(10) }, { cancelledAt: at(4) }]),
  },
  stockCard: {
    findMany: () =>
      delayed([
        { id: "sc-1", productId: "p-1", createdAt: at(8), valueAdjustment: money(-12), costVariance: money(-3), product: { code: "P001", name: "คอยล์เย็น" } },
      ]),
  },
};

let activity: typeof import("@/lib/document-activity");

before(async () => {
  if (mocksUnavailable) return;
  await mock.module("@/lib/db", { namedExports: { db: fakeDb } });
  activity = await import("@/lib/document-activity");
});

const CASES = [
  ["Sale", "sa-1"],
  ["Purchase", "po-1"],
  ["Receipt", "rc-1"],
  ["CreditNote", "cn-1"],
  ["PurchaseReturn", "pr-1"],
  ["SupplierDebitNote", "dn-adj"],
] as const;

type Snapshot = { ids: string[]; sha256: string };

const snapshotOf = async (entityType: (typeof CASES)[number][0], id: string, order: Schedule): Promise<Snapshot> => {
  schedule = order;
  callIndex = 0;
  const events = await activity.getDocumentActivityTimeline(entityType, id);
  const json = JSON.stringify(events);
  return { ids: events.map((event) => event.id), sha256: createHash("sha256").update(json).digest("hex") };
};

/** Captured from the sequential implementation (before the Promise.all change). */
const EXPECTED: Record<(typeof CASES)[number][0], Snapshot> = {
  Sale: {
    ids: [
      "sale-sa-1-delivery-commission-run-dc-1",
      "sale-sa-1-credit-note-cn-1",
      "sale-sa-1-receipt-rc-1",
      "sale-sa-1-warranty-claim-wc-1",
      "audit-audit-update-sa-1",
      "sale-sa-1-marketplace-settlement-ms-1",
      "sale-sa-1-receipt-rc-2",
      "audit-audit-create-sa-1",
      "sale-sa-1-quotation",
    ],
    sha256: "55438fc55d0f6a389a5ce4e16ba61708da7d695eed5feba8baad2497b71a4862",
  },
  Purchase: {
    ids: [
      "purchase-po-1-return-pr-1",
      "purchase-po-1-supplier-debit-dn-1",
      "purchase-po-1-supplier-payment-sp-1",
      "audit-audit-update-po-1",
      "purchase-po-1-supplier-payment-sp-2",
      "audit-audit-create-po-1",
    ],
    sha256: "275e9f048188e547983bd5687ebd479927b013dd0591558670624f86dec1b0b4",
  },
  Receipt: {
    ids: ["audit-audit-update-rc-1", "receipt-rc-1-sale-sa-1", "audit-audit-create-rc-1"],
    sha256: "e355055cfc3ae177289545a4b228bd4eafe5dfda4044a12dda5e9aaa24a4f543",
  },
  CreditNote: {
    ids: [
      "credit-note-cn-1-expense-ex-1",
      "credit-note-cn-1-expense-ex-2",
      "credit-note-cn-1-receipt-rc-1",
      "credit-note-cn-1-warranties",
      "audit-audit-update-cn-1",
      "credit-note-cn-1-receipt-rc-2",
      "credit-note-cn-1-sale-sa-1",
      "audit-audit-create-cn-1",
    ],
    sha256: "64cb05ee80d481ac7d85df36d7c94ee9c9a281fc76ccb1d493ed42cc818a53a2",
  },
  PurchaseReturn: {
    ids: [
      "purchase-return-pr-1-allowance-sc-1",
      "purchase-return-pr-1-supplier-payment-sp-1",
      "audit-audit-update-pr-1",
      "purchase-return-pr-1-supplier-payment-sp-2",
      "purchase-return-pr-1-purchase-po-1",
      "audit-audit-create-pr-1",
    ],
    sha256: "6e42554fef76d43c3092a238bdd7318d3560617f52f836694d3fb2516e7f8f76",
  },
  SupplierDebitNote: {
    ids: [
      "supplier-debit-dn-adj-payment-sp-3",
      "supplier-debit-dn-adj-adjustment-dn-adj",
      "supplier-debit-dn-adj-refund-dp-1",
      "audit-audit-update-dn-adj",
      "supplier-debit-dn-adj-parent-dn-1",
      "supplier-debit-dn-adj-purchase-po-1",
      "audit-audit-create-dn-adj",
    ],
    sha256: "85c832ea5c01529a57691f3a9a63b6243ef4bab780b2f4749b25ed89b89ab6b2",
  },
};

test("timelines equal the sequential version, whatever order the reads finish in", { skip: mocksUnavailable }, async () => {
  const captured: Record<string, Snapshot> = {};
  for (const [entityType, id] of CASES) {
    const ascending = await snapshotOf(entityType, id, "ascending");
    const descending = await snapshotOf(entityType, id, "descending");
    assert.deepEqual(descending, ascending, `${entityType}: result depends on read completion order`);
    captured[entityType] = ascending;
    if (process.env.GOLDEN_CAPTURE !== "1") {
      assert.deepEqual(ascending, EXPECTED[entityType], `${entityType}: differs from the sequential version`);
    }
  }
  if (process.env.GOLDEN_CAPTURE === "1") console.log(JSON.stringify(captured, null, 2));
});
