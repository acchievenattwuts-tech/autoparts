import assert from "node:assert/strict";
import { test } from "node:test";
import { calcVat, type VatType } from "@/lib/vat";
import {
  allocateSaleProfitRevenue,
  hasMoreThanTwoDecimals,
  roundStoredMoney,
  SALE_REVENUE_ALLOCATION_USER_MESSAGE,
  SaleRevenueAllocationError,
  sumSaleLineTotals,
  toStoredMoneyCents,
} from "@/lib/sale-profit-revenue";
import { buildSaleRoundingRows } from "@/app/admin/(protected)/sales/sale-rounding";

// R12 (review item E5): the sale header is computed from the ROUNDED stored line totals,
// so header == Σ lines and the profit allocator never throws inside the save. Normal
// 2-decimal prices must give byte-identical header / VAT / net amounts to before.

const modes: VatType[] = ["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"];
type Line = { qty: number; salePrice: number };

/** The header computation before R12 (plain float sum of qty × price). */
const headerBefore = (lines: Line[], shippingFee: number, discount: number, vatType: VatType, vatRate: number) => {
  const totalAmount = lines.reduce((sum, line) => sum + line.qty * line.salePrice, 0);
  return { totalAmount, ...calcVat(Math.max(0, totalAmount + shippingFee - discount), vatType, vatRate) };
};
const headerAfter = (lines: Line[], shippingFee: number, discount: number, vatType: VatType, vatRate: number) => {
  const totalAmount = sumSaleLineTotals(lines.map((line) => line.qty * line.salePrice));
  return { totalAmount, ...calcVat(Math.max(0, totalAmount + shippingFee - discount), vatType, vatRate) };
};

/** Deterministic PRNG, so a failure is reproducible. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("golden: 2-decimal prices give byte-identical header / VAT / net to the previous rule", () => {
  const fixtures: Array<{ lines: Line[]; shippingFee: number; discount: number }> = [
    { lines: [{ qty: 3, salePrice: 0.1 }], shippingFee: 0, discount: 0 },
    { lines: [{ qty: 7, salePrice: 19.99 }, { qty: 1, salePrice: 0.01 }], shippingFee: 50, discount: 12.5 },
    { lines: [{ qty: 1, salePrice: 1070 }], shippingFee: 0, discount: 0 },
    { lines: Array.from({ length: 15 }, () => ({ qty: 1, salePrice: 0.1 })), shippingFee: 0, discount: 0 },
    { lines: [{ qty: 12, salePrice: 333.33 }, { qty: 5, salePrice: 45.55 }], shippingFee: 40, discount: 100 },
  ];
  const random = lcg(20260930);
  for (let index = 0; index < 2000; index += 1) {
    const lineCount = 1 + Math.floor(random() * 6);
    fixtures.push({
      lines: Array.from({ length: lineCount }, () => ({
        qty: 1 + Math.floor(random() * 20),
        salePrice: Math.round(random() * 500000) / 100,
      })),
      shippingFee: Math.round(random() * 20000) / 100,
      discount: Math.round(random() * 5000) / 100,
    });
  }
  for (const fixture of fixtures) {
    for (const mode of modes) {
      const before = headerBefore(fixture.lines, fixture.shippingFee, fixture.discount, mode, 7);
      const after = headerAfter(fixture.lines, fixture.shippingFee, fixture.discount, mode, 7);
      for (const key of ["totalAmount", "subtotalAmount", "vatAmount", "netAmount"] as const) {
        assert.ok(Object.is(before[key], after[key]), `${mode} ${key}: ${before[key]} vs ${after[key]} for ${JSON.stringify(fixture)}`);
      }
    }
  }
});

test("golden E5: two lines of 1 × 0.004 store 0.00 each, so the header is 0.00 and allocation succeeds", () => {
  const lines = [{ qty: 1, salePrice: 0.004 }, { qty: 1, salePrice: 0.004 }];
  const lineTotals = lines.map((line) => roundStoredMoney(line.qty * line.salePrice));
  assert.deepEqual(lineTotals, [0, 0]);
  for (const mode of modes) {
    const header = headerAfter(lines, 0, 0, mode, 7);
    assert.equal(header.totalAmount, 0, "header == Σ stored lines");
    const allocation = allocateSaleProfitRevenue({ itemAmounts: lineTotals, shippingFee: 0, discount: 0,
      subtotalAmount: roundStoredMoney(header.subtotalAmount), netAmount: roundStoredMoney(header.netAmount) });
    assert.deepEqual(allocation.items, [{ exVat: 0, incVat: 0 }, { exVat: 0, incVat: 0 }]);
    // The previous rule stored a 0.01 header over 0.00 lines, which the allocator refused.
    const before = headerBefore(lines, 0, 0, mode, 7);
    if (roundStoredMoney(before.subtotalAmount) > 0) {
      assert.throws(() => allocateSaleProfitRevenue({ itemAmounts: lineTotals, shippingFee: 0, discount: 0,
        subtotalAmount: roundStoredMoney(before.subtotalAmount), netAmount: roundStoredMoney(before.netAmount) }),
      SaleRevenueAllocationError);
    }
  }
});

test("golden: mixed third decimals sum the stored line totals only when the plain sum would not reconcile", () => {
  assert.equal(sumSaleLineTotals([0.006, 0.006]), 0.02, "0.01 + 0.01 stored, not round(0.012) = 0.01");
  assert.equal(sumSaleLineTotals([0.004, 0.006]), 0.01, "plain sum already reconciles: kept");
  assert.equal(sumSaleLineTotals([1.5 * 10.33]), 1.5 * 10.33, "one line always reconciles with itself");
  assert.equal(sumSaleLineTotals([]), 0);
  assert.ok(Number.isNaN(sumSaleLineTotals([Number.NaN])), "invalid input is never thrown on");
});

test("stored-money rounding follows Decimal(10,2): half away from zero on the shortest decimal form", () => {
  assert.equal(toStoredMoneyCents(15.495), 1550);
  assert.equal(toStoredMoneyCents(1.005), 101);
  assert.equal(toStoredMoneyCents(-1.005), -101);
  assert.equal(toStoredMoneyCents(0.004), 0);
  assert.equal(toStoredMoneyCents(0.005), 1);
  assert.equal(toStoredMoneyCents(0.1 * 3), 30);
  assert.equal(toStoredMoneyCents(1e-7), 0);
  assert.ok(Object.is(toStoredMoneyCents(-0.001), 0), "no negative zero");
  assert.equal(roundStoredMoney(99999999.99), 99999999.99);
  assert.throws(() => toStoredMoneyCents(Number.POSITIVE_INFINITY), SaleRevenueAllocationError);
});

test("third-decimal detection ignores qty × price float noise", () => {
  assert.equal(hasMoreThanTwoDecimals(0.1 * 3), false);
  assert.equal(hasMoreThanTwoDecimals(7 * 19.99), false);
  assert.equal(hasMoreThanTwoDecimals(99999999.99), false);
  assert.equal(hasMoreThanTwoDecimals(0.004), true);
  assert.equal(hasMoreThanTwoDecimals(1.5 * 10.33), true);
  assert.equal(hasMoreThanTwoDecimals(12.0001), true);
});

test("an inconsistent header raises the typed error with the Thai user message", () => {
  assert.throws(
    () => allocateSaleProfitRevenue({ itemAmounts: [0, 0], shippingFee: 0, discount: 0, subtotalAmount: 0.01, netAmount: 0.01 }),
    (error: unknown) => error instanceof SaleRevenueAllocationError &&
      /no allocation basis/.test(error.message) && error.userMessage === SALE_REVENUE_ALLOCATION_USER_MESSAGE,
  );
  assert.throws(
    () => allocateSaleProfitRevenue({ itemAmounts: [10], shippingFee: 0, discount: 0, subtotalAmount: 10, netAmount: 9 }),
    SaleRevenueAllocationError,
  );
});

test("sale form rounding rows list only lines saved with rounded amounts", () => {
  const rows = buildSaleRoundingRows([
    { qty: 2, salePrice: 19.99, productName: "ไส้กรอง" },
    { qty: 1, salePrice: 0.004, productName: "น็อต" },
    { qty: 1.5, salePrice: 10.33, productName: "น้ำมัน" },
  ]);
  assert.deepEqual(rows.map((row) => [row.lineNo, row.productName, row.savedUnitPrice, row.savedLineAmount]), [
    [2, "น็อต", 0, 0],
    [3, "น้ำมัน", 10.33, 15.5],
  ]);
  assert.deepEqual(buildSaleRoundingRows([{ qty: 3, salePrice: 0.1, productName: "a" }]), []);
});
