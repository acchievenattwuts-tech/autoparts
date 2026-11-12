import assert from "node:assert/strict";
import test from "node:test";

import { buildMutationBlockMessage, createDocumentMutationGuard, type GuardDb } from "../document-mutation-guard";
import {
  buildPurchaseLotEditWarning,
  checkPurchaseLotEdit,
  checkPurchaseLotReversal,
  type PurchaseLotGuardDb,
} from "../purchase-lot-reversal-guard";

// I3 (owner 2026-11-12): cancelling a purchase takes every purchased lot quantity back out of
// LotBalance. When later documents already used the lot (bought 10, sold 4 → 6 on hand), the cancel
// is blocked before any write and names the documents that used it — the credit-note guard's rule.

const PURCHASE_DATE = new Date("2026-10-03T17:00:00.000Z");

type Rows = Array<Record<string, unknown>>;

const fakeDb = (options: {
  lotQty: number;
  onHand: number | null;
  sales?: Rows;
  returns?: Rows;
  movements?: Rows;
  /** The product's flags as the lot read returns them (omitted: no product row, as before). */
  product?: { isLotControl: boolean; inventoryTracking: string; units: Rows };
}): PurchaseLotGuardDb & { calls: Array<Record<string, unknown>> } => {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    purchaseItemLot: {
      findMany: async (args) => {
        calls.push(args);
        return [{
          lotNo: "L1",
          qty: options.lotQty,
          purchaseItem: {
            productId: "p1",
            ...(options.product ? { product: options.product } : {}),
            purchase: { purchaseNo: "RR26100001", purchaseDate: PURCHASE_DATE },
          },
        }];
      },
    },
    lotBalance: {
      findMany: async () => (options.onHand === null ? [] : [{ productId: "p1", lotNo: "L1", qtyOnHand: options.onHand }]),
    },
    saleItemLot: { findMany: async () => options.sales ?? [] },
    purchaseReturnItemLot: { findMany: async () => options.returns ?? [] },
    stockMovementLot: { findMany: async () => options.movements ?? [] },
  };
};

test("a purchased lot still fully on hand can be cancelled (unchanged)", async () => {
  const db = fakeDb({ lotQty: 10, onHand: 10 });
  const result = await checkPurchaseLotReversal(db, { purchaseId: "po1" });
  assert.deepEqual(result, { blocked: false, reason: null, references: [] });
  assert.deepEqual(db.calls[0]?.where, { purchaseItem: { purchaseId: "po1" } });
});

test("bought 10, sold 4: the cancel is blocked and names the sale that used the lot", async () => {
  const result = await checkPurchaseLotReversal(
    fakeDb({ lotQty: 10, onHand: 6, sales: [{ saleItem: { sale: { id: "s9", saleNo: "SA26100009" } } }] }),
    { purchaseId: "po1" },
  );
  assert.equal(result.blocked, true);
  assert.deepEqual(result.references, [{ entityType: "Sale", id: "s9", refNo: "SA26100009" }]);
  assert.equal(
    buildMutationBlockMessage(result),
    "ไม่สามารถดำเนินการได้ เนื่องจากLot L1 ที่รับเข้าจากใบซื้อนี้ถูกนำไปใช้ต่อแล้ว ยอดคงเหลือของ Lot ไม่พอให้ถอนออก กรุณายกเลิกเอกสารที่ใช้ Lot ก่อน: SA26100009",
  );
});

test("a lot used by a purchase return or another stock document is named too", async () => {
  const byReturn = await checkPurchaseLotReversal(
    fakeDb({ lotQty: 5, onHand: 2, returns: [{ purchaseReturnItem: { purchaseReturn: { id: "pr1", returnNo: "PR26100001" } } }] }),
    { purchaseId: "po1" },
  );
  assert.deepEqual(byReturn.references, [{ entityType: "PurchaseReturn", id: "pr1", refNo: "PR26100001" }]);
  const byAdjustment = await checkPurchaseLotReversal(
    fakeDb({ lotQty: 5, onHand: 2, movements: [{ stockCard: { docNo: "AJ26100002" } }] }),
    { purchaseId: "po1" },
  );
  assert.deepEqual(byAdjustment.references, [{ entityType: "StockCard", id: "p1", refNo: "AJ26100002" }]);
});

test("a missing LotBalance row counts as nothing on hand", async () => {
  const result = await checkPurchaseLotReversal(fakeDb({ lotQty: 1, onHand: null }), { purchaseId: "po1" });
  assert.equal(result.blocked, true);
  assert.equal(result.references[0]?.refNo, "การ์ดสต๊อก Lot L1");
});

test("a purchase without lots reads one empty list and passes", async () => {
  const result = await checkPurchaseLotReversal({ purchaseItemLot: { findMany: async () => [] } }, { purchaseId: "po1" });
  assert.equal(result.blocked, false);
  assert.equal((await checkPurchaseLotReversal({}, { purchaseId: "po1" })).blocked, false);
});

test("the Purchase guard runs the lot check on cancel only — an edit nets the lot change instead", async () => {
  const database = {
    stockCard: { findMany: async () => [] },
    purchaseReturn: { findMany: async () => [] },
    supplierPaymentItem: { findMany: async () => [] },
    supplierDebitNote: { findMany: async () => [] },
    ...fakeDb({ lotQty: 10, onHand: 6 }),
  } as unknown as GuardDb;
  const guard = createDocumentMutationGuard(database);
  assert.equal((await guard.check("Purchase", "po1", "cancel")).blocked, true);
  assert.equal((await guard.check("Purchase", "po1", "update")).blocked, false);
});

test("an ACTIVE downstream document keeps its own reason and the lot check is not reached", async () => {
  const lotDb = fakeDb({ lotQty: 10, onHand: 6 });
  const database = {
    stockCard: { findMany: async () => [] },
    purchaseReturn: { findMany: async () => [{ id: "pr1", returnNo: "PR26100001" }] },
    supplierPaymentItem: { findMany: async () => [] },
    supplierDebitNote: { findMany: async () => [] },
    ...lotDb,
  } as unknown as GuardDb;
  const result = await createDocumentMutationGuard(database).check("Purchase", "po1", "cancel");
  assert.equal(result.reason, "ถูกนำไปใช้ที่เอกสารปลายทาง");
  assert.equal(lotDb.calls.length, 0);
});

// ── Edit (owner 2026-11-12): a lot may not drop under what was already used from it ──────────────

const LOT_PRODUCT = { isLotControl: true, inventoryTracking: "TRACKED", units: [{ name: "ชิ้น" }] };
const SALE_S9 = [{ saleItem: { sale: { id: "s9", saleNo: "SA26100009" } } }];
const editLots = (...qtys: number[]) => qtys.map((qtyInBase) => ({ productId: "p1", lotNo: "L1", qtyInBase }));

test("edit: bought 10, 4 used — 3 is refused naming lot, used, minimum and the sale; 4 and 12 pass", async () => {
  const database = fakeDb({ lotQty: 10, onHand: 6, product: LOT_PRODUCT, sales: SALE_S9 });
  const refused = await checkPurchaseLotEdit(database, { purchaseId: "po1", newLots: editLots(3) });
  assert.equal(refused.blocked, true);
  assert.deepEqual(refused.references, [{ entityType: "Sale", id: "s9", refNo: "SA26100009" }]);
  assert.equal(
    buildMutationBlockMessage(refused),
    "ไม่สามารถดำเนินการได้ เนื่องจากLot L1 (ใช้ไปแล้ว 4 ชิ้น ต้องไม่ต่ำกว่า 4 ชิ้น) ที่รับเข้าจากใบซื้อนี้ถูกนำไปใช้ต่อแล้ว กรุณาแก้จำนวนไม่ให้ต่ำกว่าที่ใช้ไป หรือยกเลิกเอกสารที่ใช้ Lot ก่อน: SA26100009",
  );
  for (const newLots of [editLots(4), editLots(12), editLots(2, 2)]) {
    assert.deepEqual(await checkPurchaseLotEdit(database, { purchaseId: "po1", newLots }), {
      blocked: false, reason: null, references: [],
    });
  }
  // The same lot number of another product does not cover it.
  const otherProduct = await checkPurchaseLotEdit(database, {
    purchaseId: "po1", newLots: [{ productId: "p2", lotNo: "L1", qtyInBase: 10 }],
  });
  assert.equal(otherProduct.blocked, true);
});

test("edit: the edit page warning comes from the same check (no lots = every lot removed)", async () => {
  const database = fakeDb({ lotQty: 10, onHand: 6, product: LOT_PRODUCT, sales: SALE_S9 });
  const removed = await checkPurchaseLotEdit(database, { purchaseId: "po1", newLots: [] });
  const refused = await checkPurchaseLotEdit(database, { purchaseId: "po1", newLots: editLots(3) });
  assert.equal(removed.reason, refused.reason);
  assert.equal(
    buildPurchaseLotEditWarning(removed),
    `หากแก้จำนวน Lot ให้ต่ำกว่าที่ใช้ไป ลบรายการ หรือเปลี่ยนเลข Lot สินค้า หรือหน่วย จะบันทึกไม่ได้ เนื่องจาก${removed.reason}: SA26100009`,
  );
  assert.equal(buildPurchaseLotEditWarning({ blocked: false, reason: null, references: [] }), null);
});

test("edit: cancel and edit read the purchase's lots with the same query", async () => {
  const database = fakeDb({ lotQty: 10, onHand: 10, product: LOT_PRODUCT });
  await checkPurchaseLotReversal(database, { purchaseId: "po1" });
  await checkPurchaseLotEdit(database, { purchaseId: "po1", newLots: [] });
  assert.equal(database.calls.length, 2);
  assert.deepEqual(database.calls[1], database.calls[0]);
});

test("edit: nothing used, a lot pooled with another purchase, or a product not lot-controlled never blocks", async () => {
  const unused = fakeDb({ lotQty: 10, onHand: 10, product: LOT_PRODUCT, sales: SALE_S9 });
  assert.equal((await checkPurchaseLotEdit(unused, { purchaseId: "po1", newLots: [] })).blocked, false);
  // Another purchase also brought L1 in: on hand 11 ≥ 10 bought here, so this purchase's lot is not short.
  const pooled = fakeDb({ lotQty: 10, onHand: 11, product: LOT_PRODUCT });
  assert.equal((await checkPurchaseLotEdit(pooled, { purchaseId: "po1", newLots: editLots(3) })).blocked, false);
  for (const product of [
    { ...LOT_PRODUCT, isLotControl: false },
    { ...LOT_PRODUCT, inventoryTracking: "NON_TRACKED" },
    undefined,
  ]) {
    const notLot = fakeDb({ lotQty: 10, onHand: 6, product, sales: SALE_S9 });
    assert.equal((await checkPurchaseLotEdit(notLot, { purchaseId: "po1", newLots: [] })).blocked, false);
  }
  // A purchase without lots reads one empty list.
  assert.equal((await checkPurchaseLotEdit({ purchaseItemLot: { findMany: async () => [] } }, {
    purchaseId: "po1", newLots: [],
  })).blocked, false);
});

test("edit: a fractional use shows the lowest quantity that can be keyed (2 decimals, rounded up)", async () => {
  const database = fakeDb({ lotQty: 10, onHand: 6.6667, product: LOT_PRODUCT, sales: SALE_S9 });
  const refused = await checkPurchaseLotEdit(database, { purchaseId: "po1", newLots: editLots(3.33) });
  assert.match(refused.reason ?? "", /^Lot L1 \(ใช้ไปแล้ว 3\.33 ชิ้น ต้องไม่ต่ำกว่า 3\.34 ชิ้น\)/);
  assert.equal((await checkPurchaseLotEdit(database, { purchaseId: "po1", newLots: editLots(3.34) })).blocked, false);
});
