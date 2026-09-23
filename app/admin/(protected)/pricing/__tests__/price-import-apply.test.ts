import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { AuditLogInput } from "@/lib/audit-log";
import { parsePriceImportCsv } from "@/lib/pricing/price-import";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

// applyPriceImport used to write each changed price with its own update(). It now
// batches rows that share a new amount into one updateMany. These tests pin the
// stored result, the counts and the audit entry to what the per-row loop wrote.

type PriceRow = { amount: number; touched: number };
type Product = { id: string; code: string; isActive: boolean };

const PRICE_LIST = { id: "pl-tiktok", code: "TIKTOK" };
const PRODUCTS: Product[] = Array.from({ length: 12 }, (_, index) => ({
  id: `prod-${index}`,
  code: `P${String(index).padStart(3, "0")}`,
  isActive: index !== 11,
}));

const key = (productId: string, priceListId: string): string => `${productId}|${priceListId}`;

const seedPrices = (): Map<string, PriceRow> =>
  new Map([
    [key("prod-0", PRICE_LIST.id), { amount: 100, touched: 0 }],
    [key("prod-1", PRICE_LIST.id), { amount: 150, touched: 0 }],
    [key("prod-2", PRICE_LIST.id), { amount: 150, touched: 0 }],
    [key("prod-3", PRICE_LIST.id), { amount: 90.5, touched: 0 }],
    [key("prod-4", PRICE_LIST.id), { amount: 320, touched: 0 }],
    [key("prod-5", PRICE_LIST.id), { amount: 0, touched: 0 }],
    [key("prod-6", PRICE_LIST.id), { amount: 45, touched: 0 }],
    [key("prod-7", PRICE_LIST.id), { amount: 45, touched: 0 }],
    // Another price list's row for the same product must never be written.
    [key("prod-1", "pl-other"), { amount: 1, touched: 0 }],
  ]);

// Existing rows change to shared and distinct amounts, one stays the same, some rows are new.
const CSV = [
  "productCode,price",
  "p000,250",
  "P001,250",
  "P002,99.99",
  "P003,90.50",
  "P004,250",
  "P005,12.345",
  "P006,45",
  'P007,"1,200"',
  "P008,250",
  "P009,75",
  "P011,0",
].join("\n");

/** What the pre-batching loop produced: createMany for new rows, one update per changed row. */
const legacyExpectedPrices = (initial: Map<string, PriceRow>, csv: string): Map<string, PriceRow> => {
  const expected = new Map([...initial].map(([rowKey, row]) => [rowKey, { ...row }]));
  for (const row of parsePriceImportCsv(csv).rows) {
    const product = PRODUCTS.find((candidate) => candidate.code.toUpperCase() === row.productCode.toUpperCase());
    assert.ok(product, `fixture product ${row.productCode}`);
    const rowKey = key(product.id, PRICE_LIST.id);
    const current = expected.get(rowKey);
    if (!current) expected.set(rowKey, { amount: row.amount, touched: 1 });
    else if (current.amount !== row.amount) expected.set(rowKey, { amount: row.amount, touched: current.touched + 1 });
  }
  return expected;
};

type FakeDb = ReturnType<typeof createFakeDb>;

const createFakeDb = (
  prices: Map<string, PriceRow>,
  options: { dropBeforeUpdate?: string; products?: Product[] } = {},
) => {
  const products = options.products ?? PRODUCTS;
  const calls = { update: 0, updateMany: 0, createMany: 0 };
  const matchCodes = (codes: string[]): Product[] => {
    const wanted = new Set(codes.map((code) => code.toUpperCase()));
    return products.filter((product) => wanted.has(product.code.toUpperCase()));
  };
  type PriceWhere = { priceListId: string; productId?: { in: string[] }; product?: { code?: { in: string[] }; isActive?: boolean } };
  const rowsFor = (where: PriceWhere): Array<{ productId: string; amount: number }> => {
    const allowedIds = where.productId
      ? new Set(where.productId.in)
      : where.product?.code
        ? new Set(matchCodes(where.product.code.in).map((product) => product.id))
        : null;
    const result: Array<{ productId: string; amount: number }> = [];
    for (const [rowKey, row] of prices) {
      const [productId, priceListId] = rowKey.split("|");
      if (priceListId !== where.priceListId) continue;
      if (allowedIds && !allowedIds.has(productId)) continue;
      if (where.product?.isActive && !products.find((product) => product.id === productId)?.isActive) continue;
      result.push({ productId, amount: row.amount });
    }
    return result;
  };
  const client = {
    priceList: {
      findFirst: async ({ where }: { where: { id: string; isActive: boolean } }) =>
        where.id === PRICE_LIST.id ? { ...PRICE_LIST } : null,
    },
    product: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) =>
        matchCodes(where.code.in).map((product) => ({ ...product })),
      count: async () => products.filter((product) => product.isActive).length,
    },
    productPrice: {
      findMany: async ({ where }: { where: PriceWhere }) => rowsFor(where),
      count: async ({ where }: { where: PriceWhere }) => rowsFor(where).length,
      createMany: async ({ data }: { data: Array<{ productId: string; priceListId: string; amount: number }> }) => {
        calls.createMany += 1;
        for (const row of data) prices.set(key(row.productId, row.priceListId), { amount: row.amount, touched: 1 });
        return { count: data.length };
      },
      update: async ({ where, data }: { where: { productId_priceListId: { productId: string; priceListId: string } }; data: { amount: number } }) => {
        calls.update += 1;
        const rowKey = key(where.productId_priceListId.productId, where.productId_priceListId.priceListId);
        const current = prices.get(rowKey);
        if (!current) throw new Error("P2025");
        prices.set(rowKey, { amount: data.amount, touched: current.touched + 1 });
        return {};
      },
      updateMany: async ({ where, data }: { where: { priceListId: string; productId: { in: string[] } }; data: { amount: number } }) => {
        calls.updateMany += 1;
        if (options.dropBeforeUpdate) prices.delete(options.dropBeforeUpdate);
        let count = 0;
        for (const productId of where.productId.in) {
          const rowKey = key(productId, where.priceListId);
          const current = prices.get(rowKey);
          if (!current) continue;
          prices.set(rowKey, { amount: data.amount, touched: current.touched + 1 });
          count += 1;
        }
        return { count };
      },
    },
  };
  return { client, calls };
};

let activeDb: FakeDb | null = null;
const audits: AuditLogInput[] = [];

const loadActions = async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      get db() {
        return activeDb?.client;
      },
      dbTx: async <T>(callback: (tx: FakeDb["client"]) => Promise<T>): Promise<T> => {
        assert.ok(activeDb);
        return callback(activeDb.client);
      },
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "u1", name: "ผู้ทดสอบ" } }) },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      getAuditActorFromSession: () => ({ userId: "u1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async (input: AuditLogInput) => {
        audits.push(input);
      },
    },
  });
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  return import("../price-lists/actions");
};

let actionsPromise: ReturnType<typeof loadActions> | null = null;
const getActions = () => (actionsPromise ??= loadActions());

test(
  "batched price import stores, counts and audits exactly what the per-row loop did",
  { skip: moduleMocksUnavailable },
  async () => {
    const { applyPriceImport } = await getActions();
    const prices = seedPrices();
    const expected = legacyExpectedPrices(seedPrices(), CSV);
    activeDb = createFakeDb(prices);
    audits.length = 0;

    const result = await applyPriceImport(PRICE_LIST.id, CSV);

    assert.deepEqual(result, { updatedCount: 11 });
    assert.deepEqual(
      [...prices].sort(([a], [b]) => a.localeCompare(b)),
      [...expected].sort(([a], [b]) => a.localeCompare(b)),
      "every stored amount matches, and only the rows the loop wrote were written",
    );
    assert.equal(prices.get(key("prod-5", PRICE_LIST.id))?.amount, 12.35, "CSV rounding is unchanged");
    assert.equal(prices.get(key("prod-1", "pl-other"))?.touched, 0, "other price lists untouched");

    // 6 changed rows (P000, P001, P004 → 250; P002; P005; P007) → 4 distinct amounts.
    assert.equal(activeDb.calls.update, 0);
    assert.equal(activeDb.calls.updateMany, 4);
    assert.equal(activeDb.calls.createMany, 1);

    assert.equal(audits.length, 1);
    assert.deepEqual(
      { action: audits[0].action, entityType: audits[0].entityType, entityId: audits[0].entityId, entityRef: audits[0].entityRef, meta: audits[0].meta },
      {
        action: "UPDATE",
        entityType: "ProductPrice",
        entityId: PRICE_LIST.id,
        entityRef: PRICE_LIST.code,
        meta: { event: "BULK_IMPORT", rowCount: 11, createdCount: 3, updatedCount: 6, unchangedCount: 2 },
      },
    );
  },
);

test(
  "a price row that disappears mid-import still aborts the whole import with the old message",
  { skip: moduleMocksUnavailable },
  async () => {
    const { applyPriceImport } = await getActions();
    const prices = seedPrices();
    activeDb = createFakeDb(prices, { dropBeforeUpdate: key("prod-4", PRICE_LIST.id) });
    audits.length = 0;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      const result = await applyPriceImport(PRICE_LIST.id, CSV);
      assert.deepEqual(result, { error: "นำเข้าราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(audits.length, 0, "no audit entry for a failed import");
  },
);

test(
  "a group larger than one chunk is written in 1,000-row chunks with identical amounts",
  { skip: moduleMocksUnavailable },
  async () => {
    const { applyPriceImport } = await getActions();
    const manyProducts: Product[] = Array.from({ length: 2_500 }, (_, index) => ({
      id: `bulk-${index}`,
      code: `B${String(index).padStart(5, "0")}`,
      isActive: true,
    }));
    const prices = new Map<string, PriceRow>();
    const csvLines = ["productCode,price"];
    for (const product of manyProducts) {
      prices.set(key(product.id, PRICE_LIST.id), { amount: 10, touched: 0 });
      csvLines.push(`${product.code},20`);
    }
    activeDb = createFakeDb(prices, { products: manyProducts });
    audits.length = 0;
    const result = await applyPriceImport(PRICE_LIST.id, csvLines.join("\n"));
    assert.deepEqual(result, { updatedCount: manyProducts.length });
    assert.equal(activeDb.calls.updateMany, 3, "2,500 rows → chunks of 1,000 + 1,000 + 500");
    for (const product of manyProducts) {
      assert.deepEqual(prices.get(key(product.id, PRICE_LIST.id)), { amount: 20, touched: 1 });
    }
    assert.deepEqual(audits[0].meta, {
      event: "BULK_IMPORT",
      rowCount: manyProducts.length,
      createdCount: 0,
      updatedCount: manyProducts.length,
      unchangedCount: 0,
    });
  },
);
