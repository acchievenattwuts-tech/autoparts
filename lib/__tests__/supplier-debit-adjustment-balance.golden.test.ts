import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import {
  allocateDebitFamilyBalance, recalculateSupplierDebitBalance, splitDebitAdjustmentReduction, type DebitAdjustmentShare,
} from "@/lib/supplier-debit-balance";

/**
 * "ปรับยอด DN" balances (R5-D / ก3): a reduction first lowers the parent's outstanding balance, the excess stays as
 * supplier credit (stored as a negative amountRemain) or is refunded in cash; a positive adjustment is its own payable.
 */
const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const share = (id: string, reduction: number, consumed = 0, refunded = 0): DebitAdjustmentShare =>
  ({ id, reduction: D(reduction), consumed: D(consumed), refunded: D(refunded) });
const plain = (result: ReturnType<typeof allocateDebitFamilyBalance>) => ({ parentRemain: result.parentRemain.toNumber(),
  adjustments: result.adjustments.map((row) => ({ id: row.id, applied: row.applied.toNumber(), creditRemain: row.creditRemain.toNumber() })) });

describe("allocateDebitFamilyBalance (pure waterfall)", () => {
  it("parent 500 unpaid, adjustment -200: parent outstanding 300, no credit", () => {
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(500), [share("adj", 200)])),
      { parentRemain: 300, adjustments: [{ id: "adj", applied: 200, creditRemain: 0 }] });
  });

  it("parent 500 fully paid, adjustment -200 kept as supplier credit: credit 200", () => {
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(0), [share("adj", 200)])),
      { parentRemain: 0, adjustments: [{ id: "adj", applied: 0, creditRemain: 200 }] });
  });

  it("a payment consuming the 200 credit leaves nothing (the consumed part is fixed)", () => {
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(0), [share("adj", 200, 200)])),
      { parentRemain: 0, adjustments: [{ id: "adj", applied: 0, creditRemain: 0 }] });
  });

  it("a 200 cash refund is fixed too: no credit, parent stays settled", () => {
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(0), [share("adj", 200, 0, 200)])),
      { parentRemain: 0, adjustments: [{ id: "adj", applied: 0, creditRemain: 0 }] });
  });

  it("partly paid parent (100 open): -200 takes 100 from the parent, 100 is excess", () => {
    const split = splitDebitAdjustmentReduction(100, -200);
    assert.deepEqual([split.applied.toNumber(), split.excess.toNumber()], [100, 100]);
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(100), [share("adj", 200)])),
      { parentRemain: 0, adjustments: [{ id: "adj", applied: 100, creditRemain: 100 }] });
  });

  it("cancelling the parent's payment moves unused credit back onto the parent; consumed or refunded amounts never move", () => {
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(500), [share("credit", 200)])).parentRemain, 300);
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(500), [share("used", 200, 200)])).parentRemain, 500);
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(500), [share("refund", 200, 0, 200)])).parentRemain, 500);
  });

  it("several reductions take the open amount in posting order", () => {
    assert.deepEqual(plain(allocateDebitFamilyBalance(D(250), [share("a", 200), share("b", 100)])),
      { parentRemain: 0, adjustments: [{ id: "a", applied: 200, creditRemain: 0 }, { id: "b", applied: 50, creditRemain: 50 }] });
  });
});

type Row = { id: string; status: string; netAmount: number; amountRemain: number; adjustsDebitNoteId: string | null;
  excessSettlementType: string | null; paid: number };
const makeTx = (rows: Row[], refunds: Record<string, number> = {}) => {
  const writes: Array<{ id: string; amountRemain: number }> = [];
  const view = (row: Row) => ({ ...row, netAmount: D(row.netAmount), amountRemain: D(row.amountRemain),
    supplierPaymentItems: row.paid > 0 ? [{ paidAmount: D(row.paid) }] : [],
    adjustments: rows.filter((child) => child.adjustsDebitNoteId === row.id && child.status === "ACTIVE" && child.netAmount < 0)
      .map((child) => ({ ...child, netAmount: D(child.netAmount), amountRemain: D(child.amountRemain),
        supplierPaymentItems: child.paid > 0 ? [{ paidAmount: D(child.paid) }] : [] })) });
  const tx = {
    supplierDebitNote: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error("not found");
        return view(row);
      },
      update: async ({ where, data }: { where: { id: string }; data: { amountRemain: Prisma.Decimal } }) => {
        const row = rows.find((item) => item.id === where.id);
        assert.ok(row);
        row.amountRemain = Number(data.amountRemain);
        writes.push({ id: where.id, amountRemain: row.amountRemain });
        return row;
      },
    },
    documentPayment: { findMany: async ({ where }: { where: { docId: { in: string[] } } }) =>
      where.docId.in.filter((id) => refunds[id]).map((id) => ({ docId: id, amount: D(refunds[id]) })) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, writes };
};
const row = (id: string, netAmount: number, overrides: Partial<Row> = {}): Row => ({ id, status: "ACTIVE", netAmount,
  amountRemain: 0, adjustsDebitNoteId: null, excessSettlementType: null, paid: 0, ...overrides });

describe("recalculateSupplierDebitBalance (stored balances)", () => {
  it("recalculating from the adjustment updates the parent to 300 and keeps the adjustment at 0", async () => {
    const rows = [row("parent", 500, { amountRemain: 500 }), row("adj", -200, { adjustsDebitNoteId: "parent" })];
    const { tx } = makeTx(rows);
    await recalculateSupplierDebitBalance(tx, "adj");
    assert.deepEqual(rows.map((item) => [item.id, item.amountRemain]), [["parent", 300], ["adj", 0]]);
  });

  it("paid parent + SUPPLIER_CREDIT: the credit 200 is stored as amountRemain -200", async () => {
    const rows = [row("parent", 500, { paid: 500 }), row("adj", -200, { adjustsDebitNoteId: "parent", excessSettlementType: "SUPPLIER_CREDIT" })];
    const { tx } = makeTx(rows);
    await recalculateSupplierDebitBalance(tx, "adj");
    assert.deepEqual(rows.map((item) => [item.id, item.amountRemain]), [["parent", 0], ["adj", -200]]);
  });

  it("a payment applying the credit brings it to 0 (recalculated from the payment side)", async () => {
    const rows = [row("parent", 500, { paid: 500 }),
      row("adj", -200, { adjustsDebitNoteId: "parent", excessSettlementType: "SUPPLIER_CREDIT", amountRemain: -200, paid: 200 })];
    const { tx } = makeTx(rows);
    await recalculateSupplierDebitBalance(tx, "adj");
    assert.equal(rows[1].amountRemain, 0);
  });

  it("paid parent + CASH_REFUND 200: nothing left on either document", async () => {
    const rows = [row("parent", 500, { paid: 500 }), row("adj", -200, { adjustsDebitNoteId: "parent", excessSettlementType: "CASH_REFUND" })];
    const { tx } = makeTx(rows, { adj: 200 });
    await recalculateSupplierDebitBalance(tx, "parent");
    assert.deepEqual(rows.map((item) => [item.id, item.amountRemain]), [["parent", 0], ["adj", 0]]);
  });

  it("a +100 adjustment is its own payable (100) and leaves the parent untouched", async () => {
    const rows = [row("parent", 500, { amountRemain: 500 }), row("plus", 100, { adjustsDebitNoteId: "parent", amountRemain: 100 })];
    const { tx, writes } = makeTx(rows);
    await recalculateSupplierDebitBalance(tx, "plus");
    assert.deepEqual(writes, [{ id: "plus", amountRemain: 100 }]);
    assert.equal(rows[0].amountRemain, 500);
  });

  it("a cancelled reduction is zeroed and the parent gets its 200 back", async () => {
    const rows = [row("parent", 500, { amountRemain: 300 }), row("adj", -200, { adjustsDebitNoteId: "parent", status: "CANCELLED" })];
    const { tx } = makeTx(rows);
    await recalculateSupplierDebitBalance(tx, "adj");
    assert.deepEqual(rows.map((item) => [item.id, item.amountRemain]), [["parent", 500], ["adj", 0]]);
  });

  it("a DN without adjustments keeps amountRemain = net - active payments", async () => {
    const rows = [row("dn", 500, { amountRemain: 500, paid: 125 })];
    const { tx } = makeTx(rows);
    await recalculateSupplierDebitBalance(tx, "dn");
    assert.equal(rows[0].amountRemain, 375);
  });
});
