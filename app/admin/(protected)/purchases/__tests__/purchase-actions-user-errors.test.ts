import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Server-action guard tests for purchases / purchase returns. The DB, auth, and
// request context are module-mocked, so no test here touches a real database.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;

// Generic Prisma-like client: every model method resolves to an "empty" result
// unless the current test overrides it.
const makeClient = (overrides: () => ModelOverrides) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw") return async () => 0;
        if (modelName === "$queryRaw") return async () => [];
        return new Proxy(
          {},
          {
            get: (_m, method: string) =>
              overrides()[modelName]?.[method] ??
              (async () => {
                if (method === "findMany") return [];
                if (method.startsWith("find")) return null;
                if (method === "count") return 0;
                return { id: `${modelName}-id` };
              }),
          },
        );
      },
    },
  );

let txOverrides: ModelOverrides = {};
let dbOverrides: ModelOverrides = {};
let dbTxImpl: ((fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>) | null = null;
const criticalReports: unknown[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides);
  const fakeDb = makeClient(() => dbOverrides);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: fakeDb,
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => (dbTxImpl ? dbTxImpl(fn) : fn(fakeTx)),
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
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

beforeEach(() => {
  txOverrides = {};
  dbOverrides = {};
  dbTxImpl = null;
  criticalReports.length = 0;
});

const purchaseForm = (overrides: Record<string, string> = {}): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    supplierId: "sup-1",
    purchaseDate: "2026-09-23",
    purchaseType: "CREDIT_PURCHASE",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 2, costPrice: 50, lotItems: [] }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

const purchaseReturnForm = (overrides: Record<string, string> = {}): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    returnDate: "2026-09-23",
    supplierId: "sup-1",
    purchaseId: "purchase-1",
    type: "RETURN",
    settlementType: "SUPPLIER_CREDIT",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 1, lotItems: [] }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

test("createPurchase returns the real message for a missing unit and sends no critical alert", { skip: moduleMocksUnavailable }, async () => {
  txOverrides = {
    product: {
      findMany: async () => [
        { id: "prod-1", inventoryTracking: "NON_TRACKED", isLotControl: false, requireExpiryDate: false },
      ],
    },
  };
  const { createPurchase } = await import("../actions");

  const result = await createPurchase(purchaseForm());

  assert.equal(result.error, "ไม่พบหน่วยนับ ชิ้น ของสินค้า");
  assert.equal(criticalReports.length, 0);
});

test("createPurchase still reports unexpected errors and keeps the generic message", { skip: moduleMocksUnavailable }, async () => {
  dbTxImpl = async () => {
    throw new Error("connection reset");
  };
  const { createPurchase } = await import("../actions");

  const result = await createPurchase(purchaseForm());

  assert.equal(result.error, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  assert.equal(criticalReports.length, 1);
});

test("createPurchase rejects a non-date purchaseDate with a Thai validation message", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");

  const result = await createPurchase(purchaseForm({ purchaseDate: "not-a-date" }));

  assert.equal(result.error, "กรุณาระบุวันที่ซื้อให้ถูกต้อง");
  assert.equal(criticalReports.length, 0);
});

test("createPurchase regenerates purchaseNo and retries when another save took the number", { skip: moduleMocksUnavailable }, async () => {
  let lookups = 0;
  dbOverrides = {
    purchase: {
      // generatePurchaseNo reads the latest number: first RRC26090006, then RRC26090007.
      findFirst: async () => {
        lookups += 1;
        return { purchaseNo: lookups === 1 ? "RRC26090006" : "RRC26090007" };
      },
    },
  };
  const usedNumbers: string[] = [];
  let attempts = 0;
  txOverrides = {
    product: {
      findMany: async () => [
        { id: "prod-1", inventoryTracking: "NON_TRACKED", isLotControl: false, requireExpiryDate: false },
      ],
    },
    productUnit: {
      findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }],
    },
    purchase: {
      create: async (args: unknown) => {
        attempts += 1;
        const purchaseNo = (args as { data: { purchaseNo: string } }).data.purchaseNo;
        usedNumbers.push(purchaseNo);
        if (attempts === 1) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
            meta: { target: ["purchaseNo"] },
          });
        }
        return { id: "purchase-new" };
      },
    },
  };
  const { createPurchase } = await import("../actions");

  const result = await createPurchase(purchaseForm());

  assert.deepEqual(usedNumbers, ["RRC26090007", "RRC26090008"]);
  assert.equal(result.error, undefined);
  assert.equal(result.purchaseNo, "RRC26090008");
  assert.equal(result.purchaseId, "purchase-new");
  assert.equal(criticalReports.length, 0);
});

test("createPurchaseReturn explains a cancelled source purchase without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  txOverrides = {
    purchase: {
      findUnique: async () => ({ id: "purchase-1", status: "CANCELLED", supplierId: "sup-1", purchaseNo: "RR26090001" }),
    },
  };
  const { createPurchaseReturn } = await import("../../purchase-returns/actions");

  const result = await createPurchaseReturn(purchaseReturnForm());

  assert.equal(result.error, "ไม่พบใบซื้ออ้างอิง หรือเอกสารถูกยกเลิกแล้ว");
  assert.equal(criticalReports.length, 0);
});

test("createPurchaseReturn explains a refund total mismatch without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  txOverrides = {
    purchase: {
      findUnique: async () => ({ id: "purchase-1", status: "ACTIVE", supplierId: "sup-1", purchaseNo: "RR26090001" }),
    },
    productUnit: {
      findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }],
    },
    product: {
      findMany: async () => [
        { id: "prod-1", avgCost: 100, costPrice: 100, inventoryTracking: "NON_TRACKED", isLotControl: false },
      ],
    },
  };
  const { createPurchaseReturn } = await import("../../purchase-returns/actions");

  const result = await createPurchaseReturn(
    purchaseReturnForm({
      purchaseId: "",
      settlementType: "CASH_REFUND",
      payments: JSON.stringify([{ cashBankAccountId: "acc-1", amount: 1 }]),
      items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 1, costPrice: 100, lotItems: [] }]),
    }),
  );

  assert.match(result.error ?? "", /ไม่ตรงกับยอดเอกสาร/);
  assert.equal(criticalReports.length, 0);
});
