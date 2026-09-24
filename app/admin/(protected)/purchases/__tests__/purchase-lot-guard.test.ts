import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getPurchaseLineLotError } from "../purchase-lot-guard";

// Server-side lot guard for purchases: a tracked lot-controlled product must always
// name its lots, otherwise StockCard goes up but no ProductLot / LotBalance is written.

const EMPTY_LOTS_ERROR = "กรุณาระบุ Lot อย่างน้อย 1 รายการ";
const lot = (lotNo: string, qty: number, expDate = "") => ({ lotNo, qty, unitCost: 50, mfgDate: "", expDate });
const guardLine = (overrides: Partial<Parameters<typeof getPurchaseLineLotError>[0]> = {}) => ({
  isTracked: true,
  isLotControl: true,
  requireExpiryDate: false,
  lotItems: [],
  qty: 2,
  ...overrides,
});

test("tracked lot-controlled purchase line with no lots is rejected", () => {
  assert.equal(getPurchaseLineLotError(guardLine()), EMPTY_LOTS_ERROR);
});

test("tracked lot-controlled purchase line still runs the full lot validation", () => {
  assert.match(getPurchaseLineLotError(guardLine({ lotItems: [lot("L1", 1)] })) ?? "", /ไม่ตรงกับจำนวนในบรรทัด/);
  assert.equal(getPurchaseLineLotError(guardLine({ lotItems: [lot(" ", 2)] })), "กรุณากรอกเลขที่ Lot");
  assert.equal(getPurchaseLineLotError(guardLine({ lotItems: [lot("L1", 1), lot("L1", 1)] })), "เลขที่ Lot ซ้ำกัน");
  assert.equal(getPurchaseLineLotError(guardLine({ lotItems: [lot("L1", 1), lot("L2", 1)] })), null);
});

test("the product's EXP requirement applies to purchase lots", () => {
  assert.match(
    getPurchaseLineLotError(guardLine({ requireExpiryDate: true, lotItems: [lot("L1", 2)] })) ?? "",
    /กรุณากรอกวันหมดอายุ \(EXP\)/,
  );
  assert.equal(
    getPurchaseLineLotError(guardLine({ requireExpiryDate: true, lotItems: [lot("L1", 2, "2027-01-31")] })),
    null,
  );
});

test("purchase lines that are not lot-controlled or not stock-tracked are untouched", () => {
  assert.equal(getPurchaseLineLotError(guardLine({ isLotControl: false })), null);
  assert.equal(getPurchaseLineLotError(guardLine({ isTracked: false })), null);
});

test("createPurchase and updatePurchase run the guard over every line before writing", () => {
  const source = readFileSync(join(process.cwd(), "app/admin/(protected)/purchases/actions.ts"), "utf8");
  assert.equal(source.match(/assertPurchaseLinesHaveLots\(validItems, productMap\);/g)?.length, 2);
  // create: guard runs before the header insert.
  const create = source.slice(source.indexOf("export async function createPurchase("));
  assert.ok(create.indexOf("assertPurchaseLinesHaveLots(") < create.indexOf("tx.purchase.create("));
  // update: guard runs before step 1 deletes lot balances / stock cards.
  const update = source.slice(source.indexOf("export async function updatePurchase("));
  assert.ok(update.indexOf("assertPurchaseLinesHaveLots(") < update.indexOf("reversePurchaseLotBalance(tx"));
  assert.ok(update.indexOf("assertPurchaseLinesHaveLots(") < update.indexOf("tx.stockCard.deleteMany("));
});

// ── createPurchase / updatePurchase with the DB, auth and request context module-mocked ──

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;

const makeClient = (overrides: () => ModelOverrides, calls: string[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw") return async () => 0;
        if (modelName === "$queryRaw") return async () => [];
        return new Proxy(
          {},
          {
            get: (_m, method: string) => {
              const override = overrides()[modelName]?.[method];
              return async (...args: unknown[]) => {
                calls.push(`${modelName}.${method}`);
                if (override) return override(...args);
                if (method === "findMany") return [];
                if (method.startsWith("find")) return null;
                if (method === "count") return 0;
                return { id: `${modelName}-id` };
              };
            },
          },
        );
      },
    },
  );

let txOverrides: ModelOverrides = {};
let dbOverrides: ModelOverrides = {};
const txCalls: string[] = [];
const criticalReports: unknown[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, []),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN" } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      safeWriteAuditLog: async () => undefined,
    },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      ...realErrorReporting,
      reportCriticalError: async (error: unknown) => {
        criticalReports.push(error);
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generatePurchaseNo: async () => "RRC202609240001" },
  });
  const realMutationGuard = await import("@/lib/document-mutation-guard");
  await mock.module("@/lib/document-mutation-guard", {
    namedExports: { ...realMutationGuard, getDocumentMutationBlockMessage: async () => null },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

beforeEach(() => {
  txOverrides = {};
  dbOverrides = {};
  txCalls.length = 0;
  criticalReports.length = 0;
});

const STOP_AFTER_ITEM_CREATE = "stop-after-purchase-item-create";
const WRITE_METHODS = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

const purchaseForm = (lotItems: ReturnType<typeof lot>[]): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    supplierId: "sup-1",
    purchaseDate: "2026-09-24",
    purchaseType: "CREDIT_PURCHASE",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 2, costPrice: 50, lotItems }]),
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

type ProductStub = { inventoryTracking: string; isLotControl: boolean; requireExpiryDate?: boolean };

const stubProduct = (product: ProductStub) => {
  txOverrides = {
    productUnit: { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] },
    product: {
      findMany: async () => [{ id: "prod-1", requireExpiryDate: false, ...product }],
    },
    // Anything that reaches the line insert has passed the lot guard; stop there.
    purchaseItem: {
      create: async () => {
        throw new Error(STOP_AFTER_ITEM_CREATE);
      },
      createMany: async () => {
        throw new Error(STOP_AFTER_ITEM_CREATE);
      },
    },
  };
};

test(
  "createPurchase rejects a tracked lot-controlled line sent without lots, before any write",
  { skip: moduleMocksUnavailable },
  async () => {
    stubProduct({ inventoryTracking: "TRACKED", isLotControl: true });
    const { createPurchase } = await import("../actions");

    const result = await createPurchase(purchaseForm([]));

    assert.equal(result.error, EMPTY_LOTS_ERROR);
    assert.deepEqual(txCalls.filter((call) => WRITE_METHODS.test(call)), []);
    assert.equal(criticalReports.length, 0);
  },
);

test(
  "createPurchase enforces the product's EXP requirement before any write",
  { skip: moduleMocksUnavailable },
  async () => {
    stubProduct({ inventoryTracking: "TRACKED", isLotControl: true, requireExpiryDate: true });
    const { createPurchase } = await import("../actions");

    const result = await createPurchase(purchaseForm([lot("L1", 2)]));

    assert.equal(result.error, "Lot L1: กรุณากรอกวันหมดอายุ (EXP)");
    assert.deepEqual(txCalls.filter((call) => WRITE_METHODS.test(call)), []);
    assert.equal(criticalReports.length, 0);
  },
);

test(
  "createPurchase lets the line through when lots are named, and when the product is not lot-controlled",
  { skip: moduleMocksUnavailable },
  async () => {
    const { createPurchase } = await import("../actions");

    for (const [product, lots] of [
      [{ inventoryTracking: "TRACKED", isLotControl: true }, [lot("L1", 2)]],
      [{ inventoryTracking: "TRACKED", isLotControl: false }, []],
      [{ inventoryTracking: "NON_TRACKED", isLotControl: true }, []],
    ] as const) {
      stubProduct(product);
      txCalls.length = 0;
      criticalReports.length = 0;

      await createPurchase(purchaseForm([...lots]));

      assert.equal(txCalls.includes("purchaseItem.create"), true, JSON.stringify(product));
      assert.equal((criticalReports[0] as Error | undefined)?.message, STOP_AFTER_ITEM_CREATE);
    }
  },
);

// An existing purchase whose single line (2 × 50, no lots) matches the incoming
// line by signature — the differential path would otherwise leave it untouched.
const existingPurchase = (lotItems: { lotNo: string; qty: number; unitCost: number; mfgDate: null; expDate: null }[]) => ({
  id: "purchase1",
  purchaseNo: "RRC202609240001",
  status: "ACTIVE",
  purchaseType: "CREDIT_PURCHASE",
  purchaseDate: new Date("2026-09-23T17:00:00.000Z"),
  shippingFee: 0,
  discount: 0,
  supplier: null,
  purchaseReturns: [],
  supplierPaymentItems: [],
  items: [
    {
      id: "pi-1",
      lineNo: 1,
      productId: "prod-1",
      quantity: 2,
      costPrice: 50,
      landedCost: 0,
      lotItems,
      product: { code: "P1", name: "สินค้า 1" },
    },
  ],
});

const stubUpdate = (product: ProductStub, existingLots: Parameters<typeof existingPurchase>[0] = []) => {
  stubProduct(product);
  txOverrides.stockCard = { groupBy: async () => [] };
  dbOverrides = {
    purchase: { findUnique: async () => existingPurchase(existingLots) },
    productUnit: { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] },
  };
};

test(
  "updatePurchase rejects a new tracked lot-controlled line without lots, before step 1 deletes anything",
  { skip: moduleMocksUnavailable },
  async () => {
    stubUpdate({ inventoryTracking: "TRACKED", isLotControl: true });
    const { updatePurchase } = await import("../actions");
    const form = purchaseForm([]);
    // A different qty so the line does not match the existing one.
    form.set("items", JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 3, costPrice: 50, lotItems: [] }]));

    const result = await updatePurchase("purchase1", form);

    assert.equal(result.error, EMPTY_LOTS_ERROR);
    assert.deepEqual(txCalls.filter((call) => WRITE_METHODS.test(call)), []);
    assert.equal(criticalReports.length, 0);
  },
);

test(
  "updatePurchase also rejects an unchanged lot-controlled line that still has no lots",
  { skip: moduleMocksUnavailable },
  async () => {
    stubUpdate({ inventoryTracking: "TRACKED", isLotControl: true });
    const { updatePurchase } = await import("../actions");

    const result = await updatePurchase("purchase1", purchaseForm([]));

    assert.equal(result.error, EMPTY_LOTS_ERROR);
    assert.deepEqual(txCalls.filter((call) => WRITE_METHODS.test(call)), []);
    assert.equal(criticalReports.length, 0);
  },
);

test(
  "updatePurchase lets a lot-controlled line with lots, and a non-lot line, through to the item insert",
  { skip: moduleMocksUnavailable },
  async () => {
    const { updatePurchase } = await import("../actions");

    for (const [product, lots] of [
      [{ inventoryTracking: "TRACKED", isLotControl: true }, [lot("L1", 3)]],
      [{ inventoryTracking: "TRACKED", isLotControl: false }, []],
    ] as const) {
      stubUpdate(product);
      txCalls.length = 0;
      criticalReports.length = 0;
      const form = purchaseForm([]);
      form.set("items", JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 3, costPrice: 50, lotItems: [...lots] }]));

      await updatePurchase("purchase1", form);

      assert.equal(txCalls.includes("purchaseItem.createMany"), true, JSON.stringify(product));
      assert.equal((criticalReports[0] as Error | undefined)?.message, STOP_AFTER_ITEM_CREATE);
    }
  },
);
