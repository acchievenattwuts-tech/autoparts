import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@/lib/generated/prisma";
import { rebuildCreditNoteProfitFacts } from "@/lib/profit-fact";
import { allocateMoneyByWeights } from "@/lib/sale-profit-revenue";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { calcVat, type VatType } from "@/lib/vat";

const cents = (amount: number): number => Math.round(amount * 100);
const cnDate = parseDateOnlyToDate("2026-09-29");

test("golden allocator: 0.02 over 4 equal lines never leaves a negative last line", () => {
  const shares = allocateMoneyByWeights(0.02, [1, 1, 1, 1]);
  assert.deepEqual(shares, [0.01, 0, 0.01, 0]);
  assert.equal(shares.reduce((sum, share) => sum + cents(share), 0), 2);
});

test("golden allocator keeps the total's sign, clamps bad weights and splits zero weights equally", () => {
  const negative = allocateMoneyByWeights(-0.02, [1, 1, 1, 1]);
  assert.ok(negative.every((share) => share <= 0 && !Object.is(share, -0)));
  assert.equal(negative.reduce((sum, share) => sum + cents(share), 0), -2);
  assert.deepEqual(allocateMoneyByWeights(0.03, [0, 0, 0]), [0.01, 0.01, 0.01]);
  assert.deepEqual(allocateMoneyByWeights(10, [-5, Number.NaN, 5]), [0, 0, 10]);
  assert.deepEqual(allocateMoneyByWeights(10, []), []);
});

type CreditNoteFixture = ReturnType<typeof makeCreditNote>;

function makeCreditNote(vatType: VatType, lineAmounts: number[]) {
  const header = calcVat(lineAmounts.reduce((sum, amount) => sum + amount, 0), vatType, 7);
  return {
    id: "cn-1", cnNo: "CN202609290001", cnDate, status: "ACTIVE", type: "RETURN", saleId: null,
    channel: null, totalAmount: header.netAmount, subtotalAmount: header.subtotalAmount,
    customerId: null, customerName: "ลูกค้าทดสอบ", sale: null, customer: null,
    items: lineAmounts.map((amount, index) => ({
      id: `cn-item-${index + 1}`, saleItemId: null, productId: `product-${index + 1}`, qty: 1, amount,
      unitPrice: amount, stockDisposition: "RESTOCK",
      product: { code: `P${index + 1}`, name: `สินค้า ${index + 1}`, avgCost: 0 },
    })),
  };
}

async function rebuild(creditNote: CreditNoteFixture): Promise<Prisma.FactProfitCreateInput[]> {
  const rows: Prisma.FactProfitCreateInput[] = [];
  const tx = {
    creditNote: { findUnique: async () => creditNote },
    factProfit: {
      updateMany: async () => ({ count: 0 }),
      aggregate: async () => ({ _max: { versionNo: 1 } }),
      create: async ({ data }: { data: Prisma.FactProfitCreateInput }) => { rows.push(data); return data; },
    },
  } as unknown as Parameters<typeof rebuildCreditNoteProfitFacts>[0];
  await rebuildCreditNoteProfitFacts(tx, creditNote.id);
  return rows;
}

test("golden SALE_RETURN: 0.02 over 4 equal lines has no wrong-sign line and keeps document totals", async () => {
  // Equal line weights with a smaller posted header: the old float allocator produced
  // 0.01, 0.01, 0.01, -0.01, i.e. a return line with positive revenue.
  const creditNote = makeCreditNote("NO_VAT", [0.01, 0.01, 0.01, 0.01]);
  creditNote.subtotalAmount = 0.02;
  creditNote.totalAmount = 0.02;
  const tinyRows = await rebuild(creditNote);
  assert.equal(tinyRows.length, 4);
  assert.deepEqual(tinyRows.map((row) => Number(row.salesAmountExVat)), [-0.01, 0, -0.01, 0]);
  assert.ok(tinyRows.every((row) => Number(row.salesAmountExVat) <= 0 && Number(row.salesAmountIncVat) <= 0));
  assert.equal(tinyRows.reduce((sum, row) => sum + cents(Number(row.salesAmountExVat)), 0), -2);
  assert.equal(tinyRows.reduce((sum, row) => sum + cents(Number(row.salesAmountIncVat)), 0), -2);
});

for (const vatType of ["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"] as const) {
  test(`golden SALE_RETURN ${vatType}: lines tie to header cents and VAT never reverses sign`, async () => {
    const creditNote = makeCreditNote(vatType, [100, 100, 100, 33.33]);
    const rows = await rebuild(creditNote);
    assert.equal(rows.reduce((sum, row) => sum + cents(Number(row.salesAmountExVat)), 0),
      -cents(creditNote.subtotalAmount));
    assert.equal(rows.reduce((sum, row) => sum + cents(Number(row.salesAmountIncVat)), 0),
      -cents(creditNote.totalAmount));
    assert.ok(rows.every((row) => Number(row.salesAmountExVat) <= 0));
    assert.ok(rows.every((row) => Number(row.salesAmountIncVat) <= Number(row.salesAmountExVat)));
  });
}
