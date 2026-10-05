import assert from "node:assert/strict";
import test from "node:test";

import { MarketplaceReturnStockDisposition, Prisma } from "@/lib/generated/prisma";
import {
  assertReturnLotsWithinSale,
  CreditNoteReturnLotError,
  loadSaleLineLotBalances,
  toSaleLotOptions,
} from "../credit-note-sale-lots";

type ReturnedLotRow = {
  creditNoteItemId: string;
  lotNo: string;
  qty: number;
  isReturnLot: boolean;
  saleItemId: string | null;
  productId: string;
};

/** A transaction stand-in returning fixed rows; the guard's own logic is what is tested. */
const fakeTx = (returnedLots: ReturnedLotRow[] = []) => ({
  saleItem: {
    findMany: async () => [
      { id: "si1", productId: "p1" },
      { id: "si2", productId: "p2" },
    ],
  },
  saleItemLot: {
    findMany: async () => [
      { saleItemId: "si1", lotNo: "L001", qty: new Prisma.Decimal(3), unitCost: new Prisma.Decimal(10) },
      { saleItemId: "si1", lotNo: "L002", qty: new Prisma.Decimal(2), unitCost: new Prisma.Decimal(12) },
    ],
  },
  productLot: {
    findMany: async () => [
      { productId: "p1", lotNo: "L001", mfgDate: null, expDate: new Date("2027-01-01T00:00:00+07:00") },
    ],
  },
  creditNoteItemLot: {
    findMany: async () =>
      returnedLots.map((row) => ({
        creditNoteItemId: row.creditNoteItemId,
        lotNo: row.lotNo,
        qty: new Prisma.Decimal(row.qty),
        isReturnLot: row.isReturnLot,
        creditNoteItem: { saleItemId: row.saleItemId, productId: row.productId },
      })),
  },
  productUnit: {
    findMany: async () => [{ productId: "p1", name: "ชิ้น", scale: new Prisma.Decimal(1) }],
  },
});

type GuardTx = Parameters<typeof assertReturnLotsWithinSale>[0];
type LoaderClient = Parameters<typeof loadSaleLineLotBalances>[0];

const restockLine = (lotItems: { lotNo: string; qty: number }[]) => ({
  productId: "p1",
  unitName: "ชิ้น",
  stockDisposition: MarketplaceReturnStockDisposition.RESTOCK,
  lotItems,
});

test("loadSaleLineLotBalances counts a RET-lot return against its source lot", async () => {
  const balances = await loadSaleLineLotBalances(
    fakeTx([
      { creditNoteItemId: "cn-item-0012345678", lotNo: "RET-L001-12345678", qty: 1, isReturnLot: true, saleItemId: "si1", productId: "p1" },
      { creditNoteItemId: "cn-item-2", lotNo: "L002", qty: 2, isReturnLot: false, saleItemId: "si1", productId: "p1" },
    ]) as unknown as LoaderClient,
    { saleId: "s1", saleLines: [{ id: "si1", productId: "p1" }, { id: "si2", productId: "p2" }] },
  );
  const options = toSaleLotOptions(balances.get("si1") ?? []);
  assert.deepEqual(options.map((lot) => [lot.lotNo, lot.baseQty, lot.unitCostBase, lot.expDate]), [
    ["L001", 2, 10, "2027-01-01"],
  ]);
  assert.equal(balances.has("si2"), false, "a line sold without lots has no balances");
});

test("assertReturnLotsWithinSale accepts lots from the sale within what is left", async () => {
  await assertReturnLotsWithinSale(fakeTx() as unknown as GuardTx, {
    saleId: "s1",
    items: [restockLine([{ lotNo: "L001", qty: 3 }, { lotNo: "L002", qty: 2 }])],
    resolvedSaleItemIds: new Map([[0, "si1"]]),
  });
});

test("assertReturnLotsWithinSale rejects a lot the sale line did not sell", async () => {
  await assert.rejects(
    assertReturnLotsWithinSale(fakeTx() as unknown as GuardTx, {
      saleId: "s1",
      items: [restockLine([{ lotNo: "X9", qty: 1 }])],
      resolvedSaleItemIds: new Map([[0, "si1"]]),
    }),
    (error: unknown) => error instanceof CreditNoteReturnLotError && /X9/.test(error.message),
  );
});

test("assertReturnLotsWithinSale sums split lines and earlier returns per lot", async () => {
  await assert.rejects(
    assertReturnLotsWithinSale(
      fakeTx([
        { creditNoteItemId: "cn-item-1", lotNo: "L001", qty: 2, isReturnLot: false, saleItemId: "si1", productId: "p1" },
      ]) as unknown as GuardTx,
      {
        saleId: "s1",
        items: [restockLine([{ lotNo: "L001", qty: 1 }]), restockLine([{ lotNo: "L001", qty: 1 }])],
        resolvedSaleItemIds: new Map([[0, "si1"], [1, "si1"]]),
      },
    ),
    (error: unknown) => error instanceof CreditNoteReturnLotError && /L001 คืนได้อีกไม่เกิน 1 ชิ้น/.test(error.message),
  );
});

test("assertReturnLotsWithinSale leaves lines without sale lots and non-restocked lines alone", async () => {
  await assertReturnLotsWithinSale(fakeTx() as unknown as GuardTx, {
    saleId: "s1",
    items: [
      { ...restockLine([{ lotNo: "ANY", qty: 1 }]), productId: "p2" },
      { ...restockLine([{ lotNo: "X9", qty: 1 }]), stockDisposition: MarketplaceReturnStockDisposition.DAMAGED_NO_RESTOCK },
    ],
    resolvedSaleItemIds: new Map([[0, "si2"], [1, "si1"]]),
  });
});
