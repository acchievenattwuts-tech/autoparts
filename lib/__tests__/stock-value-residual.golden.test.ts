import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";
import {
  computeStockValueResidual, recalculateStockCard, replayStockCardMavg, sortRowsForReplay,
  STOCK_VALUE_RESIDUAL_START_DATE, writeStockCard,
} from "@/lib/stock-card";

// T3 option (b), owner approved 2026-09-30: stock value left when on-hand reaches zero becomes a cost
// variance on that row (and a STOCK_VALUE_RESIDUAL fact), from the go-live date only.

const D = (value: number) => new Prisma.Decimal(value);
type ReplayRow = Parameters<typeof replayStockCardMavg>[0][number];
let seq = 0;
const row = (day: string, sorder: number, source: string, qtyIn: number, qtyOut: number, priceIn: number,
  extra: { landedCost?: number; usesReferenceCost?: boolean; valueAdjustment?: number; epoch?: number } = {}): ReplayRow => ({
  id: `r${String(++seq).padStart(2, "0")}`, docDate: parseDateOnlyToDate(day), sorder, source,
  qtyIn: D(qtyIn), qtyOut: D(qtyOut), priceIn: D(priceIn), landedCost: D(extra.landedCost ?? 0),
  usesReferenceCost: extra.usesReferenceCost ?? false, valueAdjustment: D(extra.valueAdjustment ?? 0),
  valuationEpoch: extra.epoch ?? 0, qtyBalance: D(-999), priceBalance: D(-999), priceOut: D(-999),
});
const shift = (months: number) => (day: string): string => {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, date));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};

// Existing fixtures (stock-card-recalc-many-identity, supplier-debit-note-stock) plus the T3 cases.
const FIXTURES: Record<string, (day: (value: string) => string) => ReplayRow[]> = {
  identityP1: (d) => [
    row(d("2026-05-27"), 1, "SALE", 0, 3, 0), row(d("2026-05-27"), 2, "PURCHASE", 10, 0, 123.4567, { landedCost: 17.3 }),
    row(d("2026-05-27"), 3, "BF", 5, 0, 99.99), row(d("2026-05-28"), 1, "RETURN_IN", 1, 0, 50),
    row(d("2026-05-29"), 1, "RETURN_OUT", 0, 2, 110.25, { usesReferenceCost: true }), row(d("2026-05-30"), 1, "ADJUST_OUT", 0, 20, 0),
    row(d("2026-05-31"), 1, "ADJUST_IN", 7, 0, 33.3333)],
  identityP2: (d) => [
    row(d("2026-06-01"), 1, "PURCHASE", 2.5, 0, 10.1), row(d("2026-06-01"), 1, "PURCHASE", 1.25, 0, 11.7),
    row(d("2026-06-02"), 1, "SALE", 0, 3.1, 0), row(d("2026-06-03"), 1, "CLAIM_RECV_IN", 0.5, 0, 0)],
  debitEras: (d) => [
    row(d("2026-09-29"), 1, "PURCHASE", 10, 0, 100), row(d("2026-09-29"), 2, "SALE", 0, 2, 0),
    row(d("2026-09-29"), 3, "SUPPLIER_DEBIT", 0, 0, 0, { valueAdjustment: 400, epoch: 1 }), row(d("2026-09-29"), 4, "SALE", 0, 2, 0, { epoch: 1 }),
    row(d("2026-09-29"), 5, "SUPPLIER_DEBIT", 0, 0, 0, { valueAdjustment: 120, epoch: 2 }), row(d("2026-09-29"), 6, "SALE", 0, 1, 0, { epoch: 2 })],
  returnAfterDebit: (d) => [
    row(d("2026-09-29"), 1, "PURCHASE", 10, 0, 100), row(d("2026-09-29"), 2, "SALE", 0, 6, 0),
    row(d("2026-09-29"), 3, "SUPPLIER_DEBIT", 0, 0, 0, { valueAdjustment: 200, epoch: 1 }),
    row(d("2026-09-30"), 1, "RETURN_OUT", 0, 4, 100, { usesReferenceCost: true }),
    row(d("2026-10-01"), 1, "PURCHASE", 10, 0, 120), row(d("2026-10-02"), 1, "SALE", 0, 3, 0)],
  negativeClamp: (d) => [
    row(d("2026-09-29"), 1, "PURCHASE", 4, 0, 100), row(d("2026-09-30"), 1, "RETURN_OUT", 0, 2, 300, { usesReferenceCost: true }),
    row(d("2026-09-30"), 2, "SALE", 0, 1, 0), row(d("2026-10-01"), 1, "PURCHASE", 2, 0, 90), row(d("2026-10-01"), 2, "SALE", 0, 3, 0)],
  oversell: (d) => [
    row(d("2026-09-29"), 1, "PURCHASE", 4, 0, 150), row(d("2026-09-30"), 1, "SALE", 0, 5, 0),
    row(d("2026-10-01"), 1, "PURCHASE", 10, 0, 120), row(d("2026-10-01"), 2, "RETURN_IN", 1, 0, 0), row(d("2026-10-02"), 1, "SALE", 0, 10, 0)],
};

// Captured from the engine BEFORE this change (lib/stock-card.ts as of 2026-09-30, pre-T3): [id, priceOut, qtyBalance, priceBalance].
const PRE_T3: Record<string, { finalQty: number; finalPrice: number; updates: Array<[string, number, number, number]> }> = {
  identityP1: { finalQty: -2, finalPrice: 0, updates: [["r03", 0, 5, 99.99], ["r02", 99.99, 15, 116.7878], ["r01", 116.7878, 12, 116.7878],
    ["r04", 116.7878, 13, 116.7878], ["r05", 110.25, 11, 117.97649090909091], ["r06", 117.97649090909091, -9, 0], ["r07", 0, -2, 0]] },
  identityP2: { finalQty: 1, finalPrice: 10.633333333333336, updates: [["r01", 0, 2.5, 10.1], ["r02", 10.1, 3.75, 10.633333333333333],
    ["r03", 10.633333333333333, 0.6499999999999999, 10.633333333333333], ["r04", 10.633333333333333, 1.15, 10.633333333333336]] },
  debitEras: { finalQty: 5, finalPrice: 170, updates: [["r01", 0, 10, 100], ["r02", 100, 8, 100], ["r03", 100, 8, 150],
    ["r04", 150, 6, 150], ["r05", 150, 6, 170], ["r06", 170, 5, 170]] },
  returnAfterDebit: { finalQty: 7, finalPrice: 120, updates: [["r01", 0, 10, 100], ["r02", 100, 4, 100], ["r03", 100, 4, 150],
    ["r04", 100, 0, 0], ["r05", 0, 10, 120], ["r06", 120, 7, 120]] },
  negativeClamp: { finalQty: 0, finalPrice: 60, updates: [["r01", 0, 4, 100], ["r02", 300, 2, 0], ["r03", 0, 1, 0], ["r04", 0, 3, 60], ["r05", 60, 0, 60]] },
  oversell: { finalQty: 0, finalPrice: 120, updates: [["r01", 0, 4, 150], ["r02", 150, -1, 0], ["r03", 0, 9, 120], ["r04", 120, 10, 120], ["r05", 120, 0, 120]] },
};
// Written-off amounts once every row is on/after the go-live date (fixtures shifted by 12 months).
const RESIDUALS_AFTER_GO_LIVE: Record<string, Array<[string, number]>> = {
  identityP1: [], identityP2: [], debitEras: [], returnAfterDebit: [["r04", 200]], negativeClamp: [["r02", -200]], oversell: [],
};

const replayFixture = (name: string, months: number) => {
  seq = 0;
  return replayStockCardMavg(sortRowsForReplay(FIXTURES[name](shift(months))));
};

describe("T3 replay goldens: MAVG unchanged apart from the write-off", () => {
  for (const name of Object.keys(FIXTURES)) {
    for (const months of [-12, 12]) {
      it(`${name} ${months < 0 ? "before" : "after"} go-live keeps every out price, balance and final average`, () => {
        const result = replayFixture(name, months);
        assert.deepEqual(result.updates.map((update) => [update.id, update.priceOut, update.qtyBalance, update.priceBalance]), PRE_T3[name].updates);
        assert.deepEqual([result.finalQty, result.finalPrice], [PRE_T3[name].finalQty, PRE_T3[name].finalPrice]);
        const expected = months < 0 ? [] : RESIDUALS_AFTER_GO_LIVE[name];
        assert.deepEqual(result.residuals.map((residual) => [residual.id, residual.amount]), expected);
        // Rows before go-live keep their stored cost variance (null = not written).
        if (months < 0) assert.ok(result.updates.every((update) => update.costVariance === null));
      });
    }
  }
});

describe("T3 write-off rule", () => {
  it("quantity at zero writes off the remaining value; oversold units never count", () => {
    assert.equal(computeStockValueResidual({ baQty: 4, baTotal: 600, qtyOut: 4, priceOut: 100, newBaQty: 0 }), 200);
    assert.equal(computeStockValueResidual({ baQty: 4, baTotal: 600, qtyOut: 5, priceOut: 150, newBaQty: -1 }), 0);
    assert.equal(computeStockValueResidual({ baQty: 3, baTotal: 100, qtyOut: 3, priceOut: 33.33, newBaQty: 0 }), 0.01);
    assert.equal(computeStockValueResidual({ baQty: 3, baTotal: 100, qtyOut: 3, priceOut: 100 / 3, newBaQty: 0 }), 0);
  });
  it("a value that would turn negative with stock left is clamped and recorded as a negative variance", () => {
    assert.equal(computeStockValueResidual({ baQty: 4, baTotal: 400, qtyOut: 2, priceOut: 300, newBaQty: 2 }), -200);
    assert.equal(computeStockValueResidual({ baQty: 4, baTotal: 400, qtyOut: 2, priceOut: 100, newBaQty: 2 }), 0);
  });
  it("go-live date is the owner's Thai date", () => assert.equal(STOCK_VALUE_RESIDUAL_START_DATE, "2026-09-30"));
});

// ---- Recalculation and append path against an in-memory transaction ----

type CardRow = {
  id: string; productId: string; docNo: string; docDate: Date; sorder: number; source: string; referenceId: string | null;
  qtyIn: Prisma.Decimal; qtyOut: Prisma.Decimal; priceIn: Prisma.Decimal; landedCost: Prisma.Decimal; usesReferenceCost: boolean;
  qtyBalance: Prisma.Decimal; priceBalance: Prisma.Decimal; priceOut: Prisma.Decimal; valueAdjustment: Prisma.Decimal;
  costVariance: Prisma.Decimal; valuationEpoch: number;
};
type Fact = { id: string; sourceType: string; sourceId: string; sourceLineId: string | null; sourceSubtype: string | null;
  sourceDocNo: string; businessDate: Date; isActive: boolean; versionNo: number; costAmount: Prisma.Decimal;
  grossProfit: Prisma.Decimal; salesAmount: Prisma.Decimal; netProfitAmount: Prisma.Decimal; productId: string | null };
type Store = { rows: CardRow[]; product: { stock: number; avgCost: Prisma.Decimal }; facts: Fact[]; factReads: number; factWrites: number };

const col = (value: unknown, scale: number) => new Prisma.Decimal(String(value)).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
const card = (id: string, day: string, sorder: number, source: string, qtyIn: number, qtyOut: number, priceIn: number,
  extra: Partial<Pick<CardRow, "usesReferenceCost" | "valuationEpoch" | "valueAdjustment">> = {}): CardRow => ({
  id, productId: "sku", docNo: `DOC-${id}`, docDate: parseDateOnlyToDate(day), sorder, source, referenceId: null,
  qtyIn: D(qtyIn), qtyOut: D(qtyOut), priceIn: D(priceIn), landedCost: D(0), usesReferenceCost: extra.usesReferenceCost ?? false,
  qtyBalance: D(0), priceBalance: D(0), priceOut: D(0), valueAdjustment: extra.valueAdjustment ?? D(0), costVariance: D(0),
  valuationEpoch: extra.valuationEpoch ?? 0,
});
type Where = Record<string, unknown>;
const matchValue = (value: unknown, condition: unknown): boolean => {
  if (condition && typeof condition === "object" && !(condition instanceof Date) && !(condition instanceof Prisma.Decimal)) {
    const c = condition as Record<string, unknown>;
    const v = value instanceof Prisma.Decimal ? value.toNumber() : value instanceof Date ? value.getTime() : value;
    const n = (x: unknown) => (x instanceof Date ? x.getTime() : x instanceof Prisma.Decimal ? x.toNumber() : x);
    if ("in" in c && !(c.in as unknown[]).map(n).includes(v)) return false;
    if ("not" in c && n(c.not) === v) return false;
    if ("gt" in c && !((v as number) > (n(c.gt) as number))) return false;
    if ("gte" in c && !((v as number) >= (n(c.gte) as number))) return false;
    if ("lt" in c && !((v as number) < (n(c.lt) as number))) return false;
    return true;
  }
  const n = (x: unknown) => (x instanceof Date ? x.getTime() : x instanceof Prisma.Decimal ? x.toNumber() : x);
  return n(value) === n(condition);
};
const matches = (record: Record<string, unknown>, where: Where = {}): boolean => Object.entries(where).every(([key, condition]) =>
  key === "OR" ? (condition as Where[]).some((part) => matches(record, part)) : matchValue(record[key], condition));
const sqlValues = (values: unknown[]): unknown[] => values.flatMap((value) =>
  typeof value === "object" && value !== null && "values" in value && "strings" in value ? (value as { values: unknown[] }).values : [value]);

const fakeTx = (store: Store) => ({
  $queryRaw: async () => [],
  $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    const flat = sqlValues(values);
    if (text.includes('"qtyBalance" = data."qtyBalance"')) {
      for (let i = 0; i < flat.length; i += 5) {
        const target = store.rows.find((r) => r.id === flat[i]);
        assert.ok(target);
        Object.assign(target, { priceOut: col(flat[i + 1], 4), qtyBalance: col(flat[i + 2], 4), priceBalance: col(flat[i + 3], 4) });
        if (flat[i + 4] !== null) target.costVariance = col(flat[i + 4], 2);
      }
    } else if (text.includes('SET "sorder" = data."sorder"')) {
      for (let i = 0; i < flat.length; i += 2) store.rows.find((r) => r.id === flat[i])!.sorder = Number(flat[i + 1]);
    } else assert.fail(`unexpected $executeRaw: ${text}`);
    return 0;
  },
  stockCard: {
    findMany: async ({ where }: { where: Where }) => store.rows
      .filter((r) => matches(r as unknown as Record<string, unknown>, where))
      .sort((a, b) => a.docDate.getTime() - b.docDate.getTime() || a.sorder - b.sorder).map((r) => ({ ...r })),
    findFirst: async ({ where, orderBy }: { where: Where; orderBy?: unknown }) => {
      const rows = store.rows.filter((r) => matches(r as unknown as Record<string, unknown>, where));
      const desc = JSON.stringify(orderBy ?? "").includes("desc");
      rows.sort((a, b) => (a.docDate.getTime() - b.docDate.getTime() || a.valuationEpoch - b.valuationEpoch || a.sorder - b.sorder) * (desc ? -1 : 1));
      return rows[0] ? { ...rows[0] } : null;
    },
    create: async ({ data }: { data: Omit<CardRow, "id" | "costVariance" | "valueAdjustment"> & { costVariance: number; valueAdjustment: number } }) => {
      const created: CardRow = { ...data, id: `new-${store.rows.length + 1}`, referenceId: data.referenceId ?? null,
        costVariance: D(data.costVariance), valueAdjustment: D(data.valueAdjustment) };
      store.rows.push(created);
      return { id: created.id };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<CardRow> }) => {
      const target = store.rows.find((r) => r.id === where.id);
      assert.ok(target);
      Object.assign(target, data);
      return target;
    },
  },
  product: {
    update: async ({ data }: { data: { stock: number; avgCost: Prisma.Decimal } }) => { store.product = { stock: data.stock, avgCost: col(data.avgCost, 2) }; return {}; },
    findUnique: async () => ({ ...store.product }),
    findMany: async () => [{ id: "sku", code: "SKU-1", name: "น้ำมันเครื่อง" }],
  },
  factProfit: {
    findMany: async ({ where }: { where: Where }) => { store.factReads += 1; return store.facts.filter((f) => matches(f as unknown as Record<string, unknown>, where)); },
    updateMany: async ({ where, data }: { where: Where; data: Partial<Fact> }) => {
      store.factWrites += 1;
      const hit = store.facts.filter((f) => matches(f as unknown as Record<string, unknown>, where));
      for (const fact of hit) Object.assign(fact, data);
      return { count: hit.length };
    },
    aggregate: async ({ where }: { where: Where }) => ({ _max: { versionNo: Math.max(0, ...store.facts
      .filter((f) => matches(f as unknown as Record<string, unknown>, where)).map((f) => f.versionNo)) || null } }),
    create: async ({ data }: { data: Omit<Fact, "id"> }) => { store.factWrites += 1; store.facts.push({ ...data, id: `fact-${store.facts.length + 1}` }); return {}; },
  },
  productStorefrontStockInvalidation: { upsert: async () => ({}), createMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) },
}) as unknown as Parameters<typeof recalculateStockCard>[0];

const activeFacts = (store: Store) => store.facts.filter((fact) => fact.isActive)
  .map((fact) => ({ line: fact.sourceLineId, doc: fact.sourceDocNo, date: fact.businessDate.toISOString(), subtype: fact.sourceSubtype,
    sourceId: fact.sourceId, cost: Number(fact.costAmount), gross: Number(fact.grossProfit), sales: Number(fact.salesAmount) }));

/** Receive 10 @ 100, sell 6, DN +50 x 10 with 4 on hand (inventory 200 -> 4 @ 150), return 4 to the supplier at 100. */
const d5Rows = (returnDay: string): CardRow[] => [
  card("receipt", "2026-09-28", 1, "PURCHASE", 10, 0, 100), card("sale", "2026-09-28", 2, "SALE", 0, 6, 0),
  card("dn", "2026-09-29", 3, "SUPPLIER_DEBIT", 0, 0, 0, { valuationEpoch: 1, valueAdjustment: D(200) }),
  // A same-day return keyed after the DN shares its epoch, so it sorts after the DN.
  card("return", returnDay, 4, "RETURN_OUT", 0, 4, 100, { usesReferenceCost: true, valuationEpoch: returnDay === "2026-09-29" ? 1 : 0 }),
];
const newStore = (rows: CardRow[]): Store => ({ rows, product: { stock: 0, avgCost: D(0) }, facts: [], factReads: 0, factWrites: 0 });

describe("T3 recalculation writes the residual row and its profit fact", () => {
  it("purchase return after a DN: residual 200 on the return row and one fact on the return date; next receipt 10 @ 120 -> avg 120", async () => {
    const store = newStore([...d5Rows("2026-10-05"), card("receipt-2", "2026-10-06", 5, "PURCHASE", 10, 0, 120)]);
    await recalculateStockCard(fakeTx(store), "sku");
    const ret = store.rows.find((r) => r.id === "return")!;
    assert.deepEqual([Number(ret.qtyBalance), Number(ret.costVariance)], [0, 200]);
    assert.equal(Number(store.rows.find((r) => r.id === "dn")!.priceBalance), 150);
    assert.deepEqual([store.product.stock, Number(store.product.avgCost)], [10, 120]);
    assert.deepEqual(activeFacts(store), [{ line: "return", doc: "DOC-return", date: parseDateOnlyToDate("2026-10-05").toISOString(),
      subtype: "RETURN_OUT", sourceId: "sku", cost: 200, gross: -200, sales: 0 }]);
    // Replaying again changes nothing: the fact set already matches, so it is only read.
    const writes = store.factWrites;
    await recalculateStockCard(fakeTx(store), "sku");
    assert.equal(store.factWrites, writes);
  });

  it("rows before the go-live date keep today's behaviour: no variance, no fact, one indexed read", async () => {
    const store = newStore(d5Rows("2026-09-29"));
    await recalculateStockCard(fakeTx(store), "sku");
    assert.equal(Number(store.rows.find((r) => r.id === "return")!.costVariance), 0);
    assert.deepEqual(activeFacts(store), []);
    assert.deepEqual([store.factReads, store.factWrites], [1, 0]);
  });

  it("rounding dust: 3 units worth 99.9999 returned at 33.33 leave 0.0099 -> 0.01 fact; a sale emptying stock leaves none", async () => {
    const dust = newStore([card("receipt", "2026-10-01", 1, "PURCHASE", 3, 0, 33.3333),
      card("return", "2026-10-02", 1, "RETURN_OUT", 0, 3, 33.33, { usesReferenceCost: true })]);
    // 3 x 33.3333 = 99.9999 on hand; returned 3 x 33.33 = 99.99 -> 0.0099 left at zero on hand, one satang rounded.
    await recalculateStockCard(fakeTx(dust), "sku");
    assert.deepEqual(activeFacts(dust).map((fact) => [fact.line, fact.cost, fact.gross]), [["return", 0.01, -0.01]]);
    const sale = newStore([card("receipt", "2026-10-01", 1, "PURCHASE", 3, 0, 33.3333), card("sale", "2026-10-02", 1, "SALE", 0, 3, 0)]);
    await recalculateStockCard(fakeTx(sale), "sku");
    assert.deepEqual(activeFacts(sale), []);
    assert.equal(Number(sale.rows.find((r) => r.id === "sale")!.costVariance), 0);
  });

  it("negative-value clamp: return 2 of 4 @ 100 at 300 records -200 (gross +200); later averages unchanged", async () => {
    const store = newStore([card("receipt", "2026-10-01", 1, "PURCHASE", 4, 0, 100),
      card("return", "2026-10-02", 1, "RETURN_OUT", 0, 2, 300, { usesReferenceCost: true }), card("receipt-2", "2026-10-03", 1, "PURCHASE", 2, 0, 90)]);
    await recalculateStockCard(fakeTx(store), "sku");
    assert.deepEqual(activeFacts(store).map((fact) => [fact.line, fact.cost, fact.gross]), [["return", -200, 200]]);
    assert.deepEqual([store.product.stock, Number(store.product.avgCost)], [4, 45]);
  });

  it("cancelling the document that carried the residual retires its fact", async () => {
    const store = newStore(d5Rows("2026-10-05"));
    await recalculateStockCard(fakeTx(store), "sku");
    assert.equal(activeFacts(store).length, 1);
    store.rows = store.rows.filter((r) => r.id !== "return");
    await recalculateStockCard(fakeTx(store), "sku");
    assert.deepEqual(activeFacts(store), []);
  });

  it("append path: a return that empties stock records the residual on the new row and rebuilds the product's facts", async () => {
    const rows = d5Rows("2026-10-05").filter((r) => r.id !== "return");
    const store = newStore(rows);
    await recalculateStockCard(fakeTx(store), "sku");
    assert.deepEqual([store.product.stock, Number(store.product.avgCost)], [4, 150]);
    const id = await writeStockCard(fakeTx(store), { productId: "sku", docNo: "PR-1", docDate: parseDateOnlyToDate("2026-10-05"),
      source: "RETURN_OUT", qtyIn: 0, qtyOut: 4, priceIn: 100, usesReferenceCost: true, valuationEpoch: 0 });
    assert.equal(Number(store.rows.find((r) => r.id === id)!.costVariance), 200);
    assert.deepEqual(activeFacts(store).map((fact) => [fact.line, fact.doc, fact.cost]), [[id, "PR-1", 200]]);
    // The full replay agrees with the append path.
    await recalculateStockCard(fakeTx(store), "sku");
    assert.deepEqual(activeFacts(store).map((fact) => [fact.line, fact.cost]), [[id, 200]]);
  });
});
