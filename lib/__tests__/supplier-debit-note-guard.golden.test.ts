import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../generated/prisma";
import {
  assertDocumentMutationAllowedInTx,
  assertStockWriteDateAllowed,
  buildMutationBlockMessage,
  buildMutationBlockReferenceLinks,
  createDocumentMutationGuard,
  DocumentMutationBlockedError,
  lockStockMutationProducts,
  getStockDocumentDebitBlocks,
  type GuardDb,
} from "../document-mutation-guard";

const postingDate = new Date("2026-09-29T00:00:00+07:00");
const originalRow = { productId: "sku-1", docNo: "PO26090001", docDate: postingDate, sorder: 2, valuationEpoch: 0 };
const debitRow = { productId: "sku-1", docNo: "SDN26090001", docDate: postingDate, sorder: 3, valuationEpoch: 1 };

test("golden batch list guard shares DN reason/links without one query per document", async () => {
  let reads = 0;
  const results = await getStockDocumentDebitBlocks({
    stockCard: { findMany: async () => ++reads === 1 ? [originalRow, { ...originalRow, docNo: "BF-after", sorder: 4, valuationEpoch: 1 }] : [debitRow] },
    supplierDebitNote: { findMany: async () => [{ id: "dn-1", debitNo: debitRow.docNo }] },
  }, [originalRow.docNo, "BF-after"]);
  assert.equal(reads, 2);
  assert.equal(results.get(originalRow.docNo)?.blocked, true);
  assert.equal(results.get("BF-after")?.blocked, false);
  assert.deepEqual(buildMutationBlockReferenceLinks(results.get(originalRow.docNo)!), [{ href: "/admin/supplier-debit-notes/dn-1", label: debitRow.docNo }]);
});

test("golden guard: original purchase stays immutable while active DN references it, even without stock", async () => {
  const queries: unknown[] = [];
  const guard = createDocumentMutationGuard({
    supplierDebitNote: { findMany: async (args) => { queries.push(args); return [{ id: "dn-1", debitNo: "SDN26090001" }]; } },
  });
  for (const action of ["update", "cancel"] as const) {
    const result = await guard.check("Purchase", "po-1", action);
    assert.equal(result.blocked, true);
    assert.deepEqual(result.references, [{ entityType: "SupplierDebitNote", id: "dn-1", refNo: "SDN26090001" }]);
    assert.deepEqual(buildMutationBlockReferenceLinks(result), [{ href: "/admin/supplier-debit-notes/dn-1", label: "SDN26090001" }]);
  }
  assert.deepEqual(queries[0], { where: { purchaseId: "po-1", status: "ACTIVE" }, select: { id: true, debitNo: true } });
});

test("golden guard: partial active payment blocks DN cancellation and lists payment", async () => {
  let query: unknown;
  const result = await createDocumentMutationGuard({ supplierPaymentItem: {
    findMany: async (args) => { query = args; return [{ payment: { id: "pay-1", paymentNo: "SP26090001" } }]; },
  } }).check("SupplierDebitNote", "dn-1", "cancel");
  assert.deepEqual(query, { where: { debitNoteId: "dn-1", payment: { status: "ACTIVE" } }, select: { payment: { select: { id: true, paymentNo: true } } } });
  assert.equal(result.blocked, true);
  assert.deepEqual(buildMutationBlockReferenceLinks(result), [{ href: "/admin/supplier-payments/pay-1", label: "SP26090001" }]);
});

test("golden guard: same-day stock before DN uses epoch boundary, not source precedence", async () => {
  const stockQueries: Array<Record<string, unknown>> = [];
  const result = await createDocumentMutationGuard({
    purchase: { findMany: async () => [{ purchaseNo: originalRow.docNo }] },
    stockCard: { findMany: async (args) => { stockQueries.push(args); return stockQueries.length === 1 ? [originalRow] : [debitRow]; } },
    supplierDebitNote: { findMany: async () => [{ id: "dn-1", debitNo: debitRow.docNo }] },
  }).check("Purchase", "po-1", "cancel");
  assert.equal(result.blocked, true);
  assert.deepEqual(stockQueries[1]?.where, {
    docNo: { notIn: ["PO26090001"] }, source: "SUPPLIER_DEBIT", OR: [{ productId: "sku-1", OR: [
      { docDate: { gt: postingDate } },
      { docDate: postingDate, valuationEpoch: { gt: 0 } },
      { docDate: postingDate, valuationEpoch: 0, sorder: { gt: 2 } },
    ] }],
  });
});

test("golden guard: a purchase after DN can still be cancelled when no later DN uses it", async () => {
  let reads = 0;
  const result = await createDocumentMutationGuard({
    purchase: { findMany: async () => [{ purchaseNo: "PO26090002" }] },
    stockCard: { findMany: async () => ++reads === 1 ? [{ ...originalRow, docNo: "PO26090002", valuationEpoch: 1, sorder: 4 }] : [] },
    supplierDebitNote: { findMany: async () => [] },
  }).check("Purchase", "po-2", "cancel");
  assert.equal(result.blocked, false);
});

test("golden guard (T1): a sale after the DN no longer blocks cancel or edit; the DN's stock is not even read", async () => {
  let stockReads = 0;
  const database: GuardDb = {
    supplierDebitNote: { findMany: async () => [{ debitNo: debitRow.docNo }] },
    stockCard: { findMany: async () => { stockReads += 1; return [debitRow, { ...debitRow, docNo: "SO26090001", sorder: 4 }]; } },
    sale: { findMany: async () => [{ id: "sale-1", saleNo: "SO26090001" }] },
    supplierPaymentItem: { findMany: async () => [] },
  };
  for (const action of ["cancel", "update"] as const) {
    assert.equal((await createDocumentMutationGuard(database).check("SupplierDebitNote", "dn-1", action)).blocked, false);
  }
  assert.equal(stockReads, 0);
});

test("golden guard (T1): an ACTIVE payment blocks the cancel but not the edit (the service checks paid <= new net)", async () => {
  let paymentReads = 0;
  const database: GuardDb = { supplierPaymentItem: { findMany: async () => {
    paymentReads += 1; return [{ payment: { id: "pay-1", paymentNo: "SP26090001" } }];
  } } };
  assert.equal((await createDocumentMutationGuard(database).check("SupplierDebitNote", "dn-1", "cancel")).blocked, true);
  assert.equal((await createDocumentMutationGuard(database).check("SupplierDebitNote", "dn-1", "update")).blocked, false);
  assert.equal(paymentReads, 1);
});

test("golden guard: latest unpaid DN has no downstream block", async () => {
  let stockReads = 0;
  const result = await createDocumentMutationGuard({
    supplierDebitNote: { findMany: async () => [{ debitNo: debitRow.docNo }] },
    stockCard: { findMany: async () => ++stockReads === 1 ? [debitRow] : [] },
    supplierPaymentItem: { findMany: async () => [] },
  }).check("SupplierDebitNote", "dn-1", "cancel");
  assert.equal(result.blocked, false);
});

test("golden guard: in-transaction recheck refuses before mutation callback", async () => {
  let writes = 0;
  const tx = { supplierDebitNote: { findMany: async () => [{ id: "dn-1", debitNo: debitRow.docNo }] } } as unknown as Prisma.TransactionClient;
  await assert.rejects(async () => {
    await assertDocumentMutationAllowedInTx(tx, "Purchase", "po-1", "cancel");
    writes++;
  }, DocumentMutationBlockedError);
  assert.equal(writes, 0);
});

test("golden guard: sorted SKU lock order deduplicates mixed source/new products", async () => {
  let values: unknown[] = [];
  const tx = { $queryRaw: async (query: { values: unknown[] }) => { values = query.values; return []; } } as unknown as Prisma.TransactionClient;
  await lockStockMutationProducts(tx, ["sku-b", "sku-a", "sku-b"]);
  assert.deepEqual(values, ["sku-a", "sku-b"]);
});

test("golden guard: bulk backdated stock writes reject with active DN number", async () => {
  let query: unknown;
  const tx = {
    stockCard: { findMany: async (args: unknown) => { query = args; return [{ docNo: debitRow.docNo }]; } },
    supplierDebitNote: { findMany: async () => [{ id: "dn-1", debitNo: debitRow.docNo }] },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(assertStockWriteDateAllowed(tx, ["sku-1"], postingDate), (error: unknown) => {
    assert.ok(error instanceof DocumentMutationBlockedError);
    assert.ok(error.message.includes("SDN26090001"));
    return true;
  });
  assert.deepEqual(query, { where: { productId: { in: ["sku-1"] }, source: "SUPPLIER_DEBIT", docDate: { gt: postingDate } }, select: { docNo: true } });
});

test("golden guard: cancelled DN does not leave an immutable purchase reference", async () => {
  const database: GuardDb = { supplierDebitNote: { findMany: async () => [] } };
  const result = await createDocumentMutationGuard(database).check("Purchase", "po-1", "update");
  assert.equal(buildMutationBlockMessage(result), null);
});
