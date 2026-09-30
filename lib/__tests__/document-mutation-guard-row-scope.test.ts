import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../generated/prisma";
import {
  assertRewrittenStockRowsAllowedInTx,
  buildMutationBlockMessage,
  buildMutationBlockReferenceLinks,
  buildRewrittenStockRowsWhere,
  buildStockDebitEditWarning,
  checkRewrittenStockRows,
  createDocumentMutationGuard,
  DocumentMutationBlockedError,
  STOCK_EDIT_BOUNDARY_REASON,
  type GuardDb,
  type MutableDocumentEntityType,
} from "../document-mutation-guard";

// R2 phase 1: the supplier-DN stock boundary only blocks mutations that delete or
// rewrite stock rows dated before an ACTIVE DN on the same SKU. Update actions check
// just the rows they rewrite; cancel / reopen still check every row of the document.

const postingDate = new Date("2026-09-29T00:00:00+07:00");
const earlierDate = new Date("2026-09-20T00:00:00+07:00");
const debitRow = { productId: "sku-1", docNo: "SDN26090001", docDate: postingDate, sorder: 9, valuationEpoch: 1 };
const ownRow = (docNo: string) => ({ productId: "sku-1", docNo, docDate: earlierDate, sorder: 2, valuationEpoch: 0 });

type Query = { where?: Record<string, unknown> };

/** A document with one stock row before an ACTIVE (or cancelled) DN on the same SKU. */
function databaseWithLaterDebit(docNo: string, options: { debitActive?: boolean; stockQueries?: Query[] } = {}): GuardDb {
  const debitActive = options.debitActive ?? true;
  const found = [{ id: "doc-1", saleNo: docNo, cnNo: docNo, returnNo: docNo, purchaseNo: docNo, claimNo: docNo }];
  return {
    stockCard: {
      findMany: async (args) => {
        options.stockQueries?.push(args as Query);
        const where = (args as Query).where ?? {};
        return JSON.stringify(where.source ?? null).includes("SUPPLIER_DEBIT") ? [debitRow] : [ownRow(docNo)];
      },
    },
    supplierDebitNote: {
      findMany: async (args) => {
        const where = (args as Query).where ?? {};
        if (where.status !== "ACTIVE" || !debitActive) return [];
        return "purchaseId" in where ? [] : [{ id: "dn-1", debitNo: debitRow.docNo }];
      },
    },
    sale: { findMany: async () => found },
    creditNote: { findMany: async (args) => ("id" in ((args as Query).where ?? {}) ? found : []) },
    purchase: { findMany: async () => found },
    purchaseReturn: { findMany: async (args) => ("id" in ((args as Query).where ?? {}) ? found : []) },
    warrantyClaim: { findMany: async () => found },
  };
}

const ROW_SCOPED: MutableDocumentEntityType[] = ["Sale", "CreditNote", "PurchaseReturn", "Purchase", "WarrantyClaim"];

for (const entityType of ROW_SCOPED) {
  test(`${entityType}: update skips the whole-document DN boundary; cancel still blocks with the DN link`, async () => {
    const updateQueries: Query[] = [];
    const update = await createDocumentMutationGuard(databaseWithLaterDebit("DOC-1", { stockQueries: updateQueries }))
      .check(entityType, "doc-1", "update");
    assert.equal(update.blocked, false);
    assert.deepEqual(updateQueries, [], "no StockCard read for a row-scoped update");

    const cancel = await createDocumentMutationGuard(databaseWithLaterDebit("DOC-1")).check(entityType, "doc-1", "cancel");
    assert.equal(cancel.blocked, true);
    assert.deepEqual(buildMutationBlockReferenceLinks(cancel), [{ href: "/admin/supplier-debit-notes/dn-1", label: "SDN26090001" }]);
  });
}

test("warranty claim reopen keeps the DN boundary", async () => {
  const result = await createDocumentMutationGuard(databaseWithLaterDebit("WCM26090001")).check("WarrantyClaim", "doc-1", "reopen");
  assert.equal(result.blocked, true);
  assert.match(buildMutationBlockMessage(result) ?? "", /SDN26090001/);
});

test("adjustments and BF keep the whole-document boundary on update; the DN itself has none (T1)", async () => {
  const bf = await createDocumentMutationGuard({
    ...databaseWithLaterDebit("BF-1"),
    balanceForward: { findMany: async () => [{ docNo: "BF-1" }] },
  }).check("BalanceForward", "bf-1", "update");
  assert.equal(bf.blocked, true);

  const queries: Query[] = [];
  await createDocumentMutationGuard({
    stockCard: { findMany: async (args) => { queries.push(args as Query); return []; } },
    supplierDebitNote: { findMany: async () => [{ debitNo: "SDN26090001" }] },
    supplierPaymentItem: { findMany: async () => [] },
  }).check("SupplierDebitNote", "dn-1", "update");
  assert.deepEqual(queries, [], "a DN edit restates later sales, so its stock rows are not a boundary");
});

test("an ACTIVE DN on the purchase still blocks a header-only purchase edit (direct reference)", async () => {
  const result = await createDocumentMutationGuard({
    supplierDebitNote: { findMany: async (args) =>
      (args as Query).where?.purchaseId === "po-1" ? [{ id: "dn-1", debitNo: "SDN26090001" }] : [] },
  }).check("Purchase", "po-1", "update");
  assert.equal(result.blocked, true);
  assert.deepEqual(result.references, [{ entityType: "SupplierDebitNote", id: "dn-1", refNo: "SDN26090001" }]);
});

test("rewritten-rows filter: all rows, the removed lines only, or none for a header-only edit", () => {
  assert.deepEqual(buildRewrittenStockRowsWhere("SA1", "ALL"), { docNo: "SA1" });
  assert.deepEqual(buildRewrittenStockRowsWhere("SA1", ["i-2", "i-1", "i-2"]), { docNo: "SA1", referenceId: { in: ["i-2", "i-1"] } });
  assert.equal(buildRewrittenStockRowsWhere("SA1", []), null);
});

test("checkRewrittenStockRows: header-only edit reads nothing and passes", async () => {
  const queries: Query[] = [];
  const result = await checkRewrittenStockRows(databaseWithLaterDebit("SA1", { stockQueries: queries }), null);
  assert.equal(result.blocked, false);
  assert.deepEqual(queries, []);
});

test("checkRewrittenStockRows: a line change on a SKU with a later ACTIVE DN is blocked with the edit reason", async () => {
  const queries: Query[] = [];
  const rowsWhere = buildRewrittenStockRowsWhere("SA1", ["item-1"]);
  const result = await checkRewrittenStockRows(databaseWithLaterDebit("SA1", { stockQueries: queries }), rowsWhere);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, STOCK_EDIT_BOUNDARY_REASON);
  assert.deepEqual(queries[0]?.where, { docNo: "SA1", referenceId: { in: ["item-1"] } }, "reads exactly the rewritten rows");
  assert.equal(
    buildMutationBlockMessage(result),
    `ไม่สามารถดำเนินการได้ เนื่องจาก${STOCK_EDIT_BOUNDARY_REASON}: SDN26090001`,
  );
});

test("checkRewrittenStockRows: a later DN that is cancelled does not block", async () => {
  const result = await checkRewrittenStockRows(databaseWithLaterDebit("SA1", { debitActive: false }), { docNo: "SA1" });
  assert.equal(result.blocked, false);
});

test("assertRewrittenStockRowsAllowedInTx throws the shared message before the caller writes", async () => {
  let writes = 0;
  const tx = databaseWithLaterDebit("PR1") as unknown as Prisma.TransactionClient;
  await assert.rejects(async () => {
    await assertRewrittenStockRowsAllowedInTx(tx, { docNo: "PR1" });
    writes += 1;
  }, (error: unknown) => error instanceof DocumentMutationBlockedError && error.message.includes("SDN26090001"));
  assert.equal(writes, 0);
  await assertRewrittenStockRowsAllowedInTx(tx, null);
});

test("edit-page warning uses the same reason and DN numbers as the action block", () => {
  const blocked = { blocked: true, reason: "x", references: [{ entityType: "SupplierDebitNote" as const, id: "dn-1", refNo: "SDN26090001" }] };
  const warning = buildStockDebitEditWarning(blocked) ?? "";
  assert.ok(warning.includes(STOCK_EDIT_BOUNDARY_REASON));
  assert.ok(warning.endsWith(": SDN26090001"));
  assert.equal(buildStockDebitEditWarning({ blocked: false, reason: null, references: [] }), null);
});
