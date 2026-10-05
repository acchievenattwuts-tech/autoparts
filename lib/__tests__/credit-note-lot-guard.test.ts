import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreditNoteLotEditWarning,
  checkCreditNoteLotReversal,
  type CreditNoteLotGuardDb,
} from "../credit-note-lot-guard";
import { buildMutationBlockMessage, createDocumentMutationGuard, type GuardDb } from "../document-mutation-guard";

const CN_DATE = new Date("2026-10-03T17:00:00.000Z");

type Rows = Array<Record<string, unknown>>;

const fakeDb = (options: {
  lotQty: number;
  onHand: number;
  isReturnLot?: boolean;
  sales?: Rows;
  movements?: Rows;
}): CreditNoteLotGuardDb & { calls: Array<Record<string, unknown>> } => {
  const calls: Array<Record<string, unknown>> = [];
  const lotNo = options.isReturnLot ? "RET-L001-12345678" : "L001";
  return {
    calls,
    creditNoteItemLot: {
      findMany: async (args) => {
        calls.push(args);
        return [{
          lotNo,
          qty: options.lotQty,
          creditNoteItem: { productId: "p1", creditNote: { cnNo: "CN26100001", cnDate: CN_DATE } },
        }];
      },
    },
    lotBalance: { findMany: async () => [{ productId: "p1", lotNo, qtyOnHand: options.onHand }] },
    saleItemLot: { findMany: async () => options.sales ?? [] },
    purchaseReturnItemLot: { findMany: async () => [] },
    stockMovementLot: { findMany: async () => options.movements ?? [] },
  };
};

test("returned lots still on hand can be reversed", async () => {
  const result = await checkCreditNoteLotReversal(fakeDb({ lotQty: 2, onHand: 2 }), { creditNoteId: "cn1" });
  assert.equal(result.blocked, false);
});

test("a RET-lot sold on is blocked and names the sale", async () => {
  const result = await checkCreditNoteLotReversal(
    fakeDb({
      lotQty: 2,
      onHand: 0,
      isReturnLot: true,
      sales: [{ saleItem: { sale: { id: "s9", saleNo: "SA26100009" } } }],
    }),
    { creditNoteId: "cn1" },
  );
  assert.equal(result.blocked, true);
  assert.deepEqual(result.references, [{ entityType: "Sale", id: "s9", refNo: "SA26100009" }]);
  assert.match(buildMutationBlockMessage(result) ?? "", /RET-L001-12345678 ที่รับคืนถูกนำไปใช้ต่อแล้ว.*SA26100009/);
});

test("a merged lot used below the returned quantity falls back to the stock card documents", async () => {
  const result = await checkCreditNoteLotReversal(
    fakeDb({ lotQty: 3, onHand: 1, movements: [{ stockCard: { docNo: "AJ26100002" } }] }),
    { creditNoteId: "cn1" },
  );
  assert.equal(result.blocked, true);
  assert.deepEqual(result.references, [{ entityType: "StockCard", id: "p1", refNo: "AJ26100002" }]);
});

test("a shortfall with no traceable document still blocks", async () => {
  const result = await checkCreditNoteLotReversal(fakeDb({ lotQty: 1, onHand: 0 }), { creditNoteId: "cn1" });
  assert.equal(result.blocked, true);
  assert.equal(result.references[0]?.refNo, "การ์ดสต๊อก Lot L001");
});

test("only RESTOCK lines are checked, and an edit with no reversed lines checks nothing", async () => {
  const db = fakeDb({ lotQty: 1, onHand: 0 });
  await checkCreditNoteLotReversal(db, { creditNoteItemIds: ["i1"] });
  assert.deepEqual(db.calls[0]?.where, { creditNoteItem: { id: { in: ["i1"] }, stockDisposition: "RESTOCK" } });
  const empty = fakeDb({ lotQty: 1, onHand: 0 });
  const result = await checkCreditNoteLotReversal(empty, { creditNoteItemIds: [] });
  assert.equal(result.blocked, false);
  assert.equal(empty.calls.length, 0);
});

test("the edit warning explains that only changed lines are blocked", async () => {
  const result = await checkCreditNoteLotReversal(fakeDb({ lotQty: 1, onHand: 0 }), { creditNoteId: "cn1" });
  assert.match(buildCreditNoteLotEditWarning(result) ?? "", /^หากแก้ไขหรือลบรายการที่รับคืนเป็น Lot จะบันทึกไม่ได้/);
});

test("the CreditNote guard runs the lot check on cancel only", async () => {
  const lotDb = fakeDb({ lotQty: 1, onHand: 0 });
  const database = {
    stockCard: { findMany: async () => [] },
    receiptItem: { findMany: async () => [] },
    marketplaceSettlementLine: { findMany: async () => [] },
    expense: { findMany: async () => [] },
    ...lotDb,
  } as unknown as GuardDb;
  const guard = createDocumentMutationGuard(database);
  assert.equal((await guard.check("CreditNote", "cn1", "cancel")).blocked, true);
  assert.equal((await guard.check("CreditNote", "cn1", "update")).blocked, false);
});
