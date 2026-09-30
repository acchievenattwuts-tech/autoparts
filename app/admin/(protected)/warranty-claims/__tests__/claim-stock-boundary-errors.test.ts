import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// createClaim / closeClaim / returnClaimToCustomer write StockCard rows. When
// writeStockCard refuses a backdated row across a supplier debit note it throws
// DocumentMutationBlockedError: the user gets its message, and no critical alert
// (Telegram) is raised — that is an expected block, not a system failure. Any
// other error is still reported as critical.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;

const makeClient = (overrides: () => ModelOverrides) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") return async () => [];
        return new Proxy(
          {},
          {
            get: (_m, method: string) => {
              const override = overrides()[modelName]?.[method];
              return async (args: unknown) => {
                if (override) return override(args);
                if (method === "findMany") return [];
                if (method.startsWith("find")) return null;
                if (method === "count") return 0;
                return { id: `${modelName}-id`, count: 0 };
              };
            },
          },
        );
      },
    },
  );

const DN_BLOCK_MESSAGE = "ไม่สามารถลงสต็อกย้อนหลังข้ามใบเพิ่มหนี้ DN26090001 กรุณายกเลิก DN ที่เกี่ยวข้องก่อน";
const FAR_FUTURE = new Date("2099-01-01T00:00:00Z");
const trackedProduct = { inventoryTracking: "TRACKED", isLotControl: false };

let overrides: ModelOverrides = {};
let writeStockCardError: Error;
let criticalReports: unknown[] = [];
let DocumentMutationBlockedError: typeof import("@/lib/document-mutation-guard").DocumentMutationBlockedError;

before(async () => {
  if (moduleMocksUnavailable) return;
  ({ DocumentMutationBlockedError } = await import("@/lib/document-mutation-guard"));
  const client = makeClient(() => overrides);
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: client,
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(client),
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
      writeAuditLogTx: async () => undefined,
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
    namedExports: { ...realDocNumber, generateClaimNo: async () => "WCM26090001" },
  });
  const realClaimStock = await import("@/lib/claim-stock");
  await mock.module("@/lib/claim-stock", {
    namedExports: {
      ...realClaimStock,
      getOriginalClaimUnitCost: async () => ({ productId: "prod-1", lotNo: "", unitCost: 50 }),
      writeClaimStockMovement: async () => "movement-1",
    },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        throw writeStockCardError;
      },
    },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

beforeEach(() => {
  criticalReports = [];
  writeStockCardError = new DocumentMutationBlockedError(DN_BLOCK_MESSAGE);
  overrides = {
    warranty: {
      findUnique: async () => ({
        id: "w-1",
        endDate: FAR_FUTURE,
        lotNo: null,
        productId: "prod-1",
        status: "ACTIVE",
        createdVia: "MANUAL",
        saleId: null,
        product: trackedProduct,
        saleItem: null,
        claims: [],
      }),
    },
    user: { findUnique: async () => ({ name: "Tester", signatureUrl: null }) },
    warrantyClaim: {
      create: async () => ({ id: "claim-1" }),
      findUnique: async () => null,
    },
  };
});

const claimRow = (fields: { status: string; outcome: string | null }) => ({
  id: "claim-1",
  claimNo: "WCM26090001",
  claimType: "CUSTOMER_WAIT",
  ...fields,
  warranty: { id: "w-1", productId: "prod-1", product: trackedProduct },
  claimStockMovements: [],
});

const createForm = (): FormData => {
  const formData = new FormData();
  formData.set("warrantyId", "w-1");
  formData.set("claimDate", "2026-09-25");
  formData.set("claimType", "REPLACE_NOW");
  return formData;
};

test("createClaim returns the stock-boundary message without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  const { createClaim } = await import("../actions");
  assert.deepEqual(await createClaim(createForm()), { error: DN_BLOCK_MESSAGE });
  assert.deepEqual(criticalReports, []);
});

test("closeClaim returns the stock-boundary message without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  overrides.warrantyClaim.findUnique = async () => claimRow({ status: "SENT_TO_SUPPLIER", outcome: null });
  const { closeClaim } = await import("../actions");
  assert.deepEqual(await closeClaim("claim-1", "RECEIVED", "2026-09-25"), { error: DN_BLOCK_MESSAGE });
  assert.deepEqual(criticalReports, []);
});

test("returnClaimToCustomer returns the stock-boundary message without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  overrides.warrantyClaim.findUnique = async () => claimRow({ status: "CLOSED", outcome: "RECEIVED" });
  const { returnClaimToCustomer } = await import("../actions");
  assert.deepEqual(await returnClaimToCustomer("claim-1", "2026-09-26"), { error: DN_BLOCK_MESSAGE });
  assert.deepEqual(criticalReports, []);
});

test("any other stock-write failure is still reported as critical", { skip: moduleMocksUnavailable }, async () => {
  writeStockCardError = new Error("connection reset");
  overrides.warrantyClaim.findUnique = async () => claimRow({ status: "CLOSED", outcome: "RECEIVED" });
  const { createClaim, returnClaimToCustomer } = await import("../actions");
  await createClaim(createForm());
  await returnClaimToCustomer("claim-1", "2026-09-26");
  assert.equal(criticalReports.length, 2);
});
