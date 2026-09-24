import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getSaleLineLotError } from "../sale-lot-guard";

// Server-side lot guard for sales: a tracked lot-controlled product must always
// name its lots, otherwise StockCard is deducted but LotBalance is not.

const EMPTY_LOTS_ERROR = "กรุณาระบุ Lot อย่างน้อย 1 รายการ";
const lot = (lotNo: string, qty: number) => ({ lotNo, qty, unitCost: 0, mfgDate: "", expDate: "" });

test("tracked lot-controlled line with no lots is rejected", () => {
  assert.equal(getSaleLineLotError({ isTracked: true, isLotControl: true, lotItems: [], qty: 2 }), EMPTY_LOTS_ERROR);
});

test("tracked lot-controlled line still runs the full lot validation", () => {
  assert.match(
    getSaleLineLotError({ isTracked: true, isLotControl: true, lotItems: [lot("L1", 1)], qty: 2 }) ?? "",
    /ไม่ตรงกับจำนวนในบรรทัด/,
  );
  assert.equal(getSaleLineLotError({ isTracked: true, isLotControl: true, lotItems: [lot("L1", 1), lot("L2", 1)], qty: 2 }), null);
});

test("lines that are not lot-controlled or not stock-tracked are untouched", () => {
  assert.equal(getSaleLineLotError({ isTracked: true, isLotControl: false, lotItems: [], qty: 2 }), null);
  assert.equal(getSaleLineLotError({ isTracked: false, isLotControl: true, lotItems: [], qty: 2 }), null);
});

test("createSale and updateSale both run the guard for every created line", () => {
  const source = readFileSync(join(process.cwd(), "app/admin/(protected)/sales/actions.ts"), "utf8");
  assert.equal(source.match(/getSaleLineLotError\(\{/g)?.length, 2);
  assert.equal(source.match(/throw new SaleLotValidationError\(lotErr\)/g)?.length, 2);
  // The old condition skipped validation whenever lotItems was empty.
  assert.doesNotMatch(source, /item\.lotItems\.length > 0 && product\?\.isLotControl/);
});

// ── createSale end-to-end with the DB, auth and request context module-mocked ──

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
const txCalls: string[] = [];
const criticalReports: unknown[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => ({}), []),
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
    namedExports: { ...realDocNumber, generateSaleNo: async () => "SAC202609240001" },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

beforeEach(() => {
  txOverrides = {};
  txCalls.length = 0;
  criticalReports.length = 0;
});

const STOP_AFTER_ITEM_CREATE = "stop-after-sale-item-create";

const saleForm = (lotItems: ReturnType<typeof lot>[]): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-09-24",
    customerId: "cust-1",
    paymentType: "CREDIT_SALE",
    fulfillmentType: "PICKUP",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 2, salePrice: 100, lotItems }]),
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

const stubProduct = (product: { inventoryTracking: string; isLotControl: boolean }) => {
  txOverrides = {
    productUnit: { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] },
    product: {
      findMany: async () => [
        { id: "prod-1", avgCost: 50, costPrice: 50, salePrice: 100, retailPrice: 100, memberPrice: 100, ...product },
      ],
    },
    // Anything that reaches the line insert has passed the lot guard; stop there.
    saleItem: {
      create: async () => {
        throw new Error(STOP_AFTER_ITEM_CREATE);
      },
    },
  };
};

test(
  "createSale rejects a tracked lot-controlled line sent without lots, before any line or stock write",
  { skip: moduleMocksUnavailable },
  async () => {
    stubProduct({ inventoryTracking: "TRACKED", isLotControl: true });
    const { createSale } = await import("../actions");

    const result = await createSale(saleForm([]));

    assert.equal(result.error, EMPTY_LOTS_ERROR);
    assert.equal(txCalls.includes("saleItem.create"), false);
    assert.equal(txCalls.some((call) => call.startsWith("stockCard.")), false);
    assert.equal(criticalReports.length, 0);
  },
);

test(
  "createSale lets the same line through when lots are named, and when the product is not lot-controlled",
  { skip: moduleMocksUnavailable },
  async () => {
    const { createSale } = await import("../actions");

    for (const [product, lots] of [
      [{ inventoryTracking: "TRACKED", isLotControl: true }, [lot("L1", 2)]],
      [{ inventoryTracking: "TRACKED", isLotControl: false }, []],
      [{ inventoryTracking: "NON_TRACKED", isLotControl: true }, []],
    ] as const) {
      stubProduct(product);
      txCalls.length = 0;
      criticalReports.length = 0;

      await createSale(saleForm([...lots]));

      assert.equal(txCalls.includes("saleItem.create"), true, JSON.stringify(product));
      assert.equal((criticalReports[0] as Error | undefined)?.message, STOP_AFTER_ITEM_CREATE);
    }
  },
);
