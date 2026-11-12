import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";
import {
  isActiveChannelRefViolation,
  normalizeChannelRefNo,
  SALE_ACTIVE_CHANNEL_REF_INDEX,
} from "@/lib/sale-channel-ref";

// M9 (review 2026-11-12): a marketplace order number is stored upper-case and trimmed, is unique among
// ACTIVE sales of the channel only (partial index "Sale_active_channel_ref_key"), and a unique violation
// on that index shows the existing Thai "order number already recorded" message. The fake transaction
// below enforces the index the way the database does, so these tests show the whole behaviour:
// a lower-case duplicate is rejected and a cancelled sale's order number can be keyed again.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type StoredSale = { id: string; channel: string; channelRefNo: string | null; status: "ACTIVE" | "CANCELLED" };

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
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
                calls.push({ method: `${modelName}.${method}`, args });
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

/** Mirrors @prisma/driver-adapter-utils: own enumerable name/cause, so they survive JSON.stringify like the real one. */
class DriverAdapterError extends Error {
  override name = "DriverAdapterError";
  override cause: unknown;
  constructor(payload: { kind: string; [field: string]: unknown }) {
    super(payload.kind);
    this.cause = payload;
  }
}

/** The P2002 Prisma 7 + adapter-pg raise for Postgres 23505 on an expression index. */
const uniqueViolation = (index: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`\"channel\"`,`upper(btrim(\"channelRefNo\"))`)",
    {
      code: "P2002", clientVersion: "test", meta: { modelName: "Sale", driverAdapterError: new DriverAdapterError({
        kind: "UniqueConstraintViolation", originalCode: "23505",
        originalMessage: `duplicate key value violates unique constraint "${index}"`,
        constraint: { fields: ["\"channel\"", "upper(btrim(\"channelRefNo\"))"] },
      }) },
    },
  );

/** The database rule: ("channel", upper(btrim("channelRefNo"))) unique WHERE ACTIVE AND channelRefNo IS NOT NULL. */
const indexKey = (sale: StoredSale): string | null =>
  sale.status === "ACTIVE" && sale.channelRefNo !== null
    ? `${sale.channel}|${sale.channelRefNo.replace(/^ +| +$/g, "").toUpperCase()}`
    : null;
const assertIndexAllows = (candidate: StoredSale): void => {
  const key = indexKey(candidate);
  if (key && storedSales.some((sale) => sale.id !== candidate.id && indexKey(sale) === key)) {
    throw uniqueViolation(SALE_ACTIVE_CHANNEL_REF_INDEX);
  }
};

let storedSales: StoredSale[] = [];
let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const dbCalls: Call[] = [];
const txCalls: Call[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, dbCalls),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", {
    namedExports: {
      ...realNotifications,
      dispatchOutOfStockAlerts: async () => undefined,
      findProductIdsWithStock: async () => [],
      safeNotifySaleBelowCost: async () => undefined,
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
    namedExports: { ...realErrorReporting, reportCriticalError: async () => undefined },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateSaleNo: async () => "SP2611120001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, recalculateStockCard: async () => undefined, writeStockCard: async () => "stock-card-id" },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reverseSaleLotBalance: async () => undefined },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: { ...realCashBank, clearCashBankSourceMovements: async () => undefined, replaceCashBankSourceMovements: async () => undefined },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: { ...realPayments, clearDocumentPayments: async () => undefined, replaceDocumentPayments: async () => undefined },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: { ...realAmountRemain, recalculateSaleAmountRemain: async () => undefined },
  });
  const realWhtReceived = await import("@/lib/wht-received");
  await mock.module("@/lib/wht-received", {
    namedExports: { ...realWhtReceived, cancelWhtReceivedForDocument: async () => undefined, persistWhtReceived: async () => undefined },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: { ...realProfitFact, rebuildSaleProfitFacts: async () => undefined },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", {
    namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

const SALE_UPDATED_AT = new Date("2026-11-12T03:00:00.000Z");
const HOLDING_ACCOUNT = "acc-shopee-hold";
const SHOPEE_CUSTOMER = "cust-shopee";
/** The message both actions already showed for a duplicate order number. */
const DUPLICATE_MESSAGE = "เลขคำสั่งซื้อ Shopeeนี้ถูกบันทึกแล้ว";

const line = { productId: "prod-1", unitName: "ชิ้น", qty: 1, salePrice: 100, unitListPrice: 100, lineDiscount: 0, warrantyDays: 0, lotItems: [] };

const existingSale = {
  id: "sale-edit", saleNo: "SP2611100001", status: "ACTIVE", channel: "SHOPEE", channelRefNo: "2411OLD",
  saleDate: new Date("2026-11-09T17:00:00.000Z"), customerId: SHOPEE_CUSTOMER, cashBankAccountId: HOLDING_ACCOUNT,
  quotationId: null, quotationRevision: null, updatedAt: SALE_UPDATED_AT, vatType: "NO_VAT", vatRate: 0,
  signerName: "Tester", signerSignatureUrl: null, signedAt: null, user: { name: "Tester", signatureUrl: null },
  items: [{
    id: "item-1", productId: "prod-1", quantity: 1, salePrice: 100, unitListPrice: 100, warrantyDays: 0, supplierId: null,
    supplierName: null, moreDetail: null, showQty: 1, showUnitName: "ชิ้น", product: { name: "ไส้กรอง" }, lotItems: [],
  }],
  creditNotes: [], receipts: [],
};

const marketplaceForm = (channelRefNo: string, saleDate = "2026-11-12"): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    channel: "SHOPEE", channelRefNo, saleDate, customerId: SHOPEE_CUSTOMER, paymentType: "CASH_SALE",
    fulfillmentType: "DELIVERY", shippingAddress: "ที่อยู่ตามระบบ Shopee", shippingMethod: "KERRY",
    vatType: "NO_VAT", vatRate: "0", items: JSON.stringify([line]),
    payments: JSON.stringify([{ cashBankAccountId: HOLDING_ACCOUNT, amount: 100 }]),
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

/** The pre-check of updateSale, run against the stored sales. */
const findFirstSale = async (args: unknown): Promise<{ id: string } | null> => {
  const where = (args as { where: { channel: string; channelRefNo: string; status?: string; id: { not: string } } }).where;
  const hit = storedSales.find((sale) => sale.channel === where.channel && sale.channelRefNo === where.channelRefNo
    && (where.status === undefined || sale.status === where.status) && sale.id !== where.id.not);
  return hit ? { id: hit.id } : null;
};

const createdRefs = (): unknown[] =>
  txCalls.filter((call) => call.method === "sale.create").map((call) => (call.args as { data: { channelRefNo: unknown } }).data.channelRefNo);

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  storedSales = [];
  const units = { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] };
  dbOverrides = {
    sale: { findUnique: async () => existingSale, findFirst: findFirstSale },
    productUnit: units,
    marketplaceChannelSetting: {
      findFirst: async () => ({
        settlementCashBankAccountId: HOLDING_ACCOUNT, defaultCustomerId: SHOPEE_CUSTOMER,
        defaultCustomer: { isActive: true, customerType: { isActive: true, priceList: { isActive: true, channel: "SHOPEE" } } },
      }),
    },
  };
  txOverrides = {
    sale: {
      findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }),
      create: async (args: unknown) => {
        const data = (args as { data: { channel: string; channelRefNo: string | null } }).data;
        const sale: StoredSale = { id: `sale-${storedSales.length + 1}`, channel: data.channel, channelRefNo: data.channelRefNo, status: "ACTIVE" };
        assertIndexAllows(sale);
        storedSales.push(sale);
        return { id: sale.id };
      },
      update: async (args: unknown) => {
        const { where, data } = args as { where: { id: string }; data: { channelRefNo?: string | null } };
        if (data.channelRefNo !== undefined) {
          assertIndexAllows({ id: where.id, channel: "SHOPEE", channelRefNo: data.channelRefNo, status: "ACTIVE" });
        }
        return { id: where.id };
      },
    },
    productUnit: units,
    cashBankAccount: { findMany: async () => [{ type: "BANK" }] },
    product: {
      findMany: async () => [{ id: "prod-1", avgCost: 40, costPrice: 40, salePrice: 100, retailPrice: 100, memberPrice: 100,
        inventoryTracking: "TRACKED", isLotControl: false }],
    },
  };
});

test("normalizeChannelRefNo trims and upper-cases; only a P2002 naming the M9 index counts", () => {
  assert.equal(normalizeChannelRefNo("  2411abcXYZ \t"), "2411ABCXYZ");
  assert.equal(normalizeChannelRefNo("241112ABC"), "241112ABC", "today's stored numbers are unchanged");
  assert.equal(isActiveChannelRefViolation(uniqueViolation(SALE_ACTIVE_CHANNEL_REF_INDEX)), true);
  assert.equal(isActiveChannelRefViolation(uniqueViolation("Sale_saleNo_key")), false);
  assert.equal(isActiveChannelRefViolation(new Error(SALE_ACTIVE_CHANNEL_REF_INDEX)), false);
});

test("createSale stores the order number upper-case and trimmed", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");
  const result = await createSale(marketplaceForm("  2411abc  "));
  assert.deepEqual(result, { success: true, saleId: "sale-1", saleNo: "SP2611120001" });
  assert.deepEqual(createdRefs(), ["2411ABC"]);
});

test("createSale rejects a lower-case duplicate of an ACTIVE sale with the Thai message", { skip: moduleMocksUnavailable }, async () => {
  storedSales = [{ id: "sale-old", channel: "SHOPEE", channelRefNo: "2411ABC", status: "ACTIVE" }];
  const { createSale } = await import("../actions");
  assert.deepEqual(await createSale(marketplaceForm("2411abc")), { error: DUPLICATE_MESSAGE });
  assert.equal(storedSales.length, 1, "nothing stored");
});

test("createSale accepts the order number of a cancelled sale", { skip: moduleMocksUnavailable }, async () => {
  storedSales = [{ id: "sale-old", channel: "SHOPEE", channelRefNo: "2411ABC", status: "CANCELLED" }];
  const { createSale } = await import("../actions");
  const result = await createSale(marketplaceForm("2411abc"));
  assert.equal(result.success, true);
  assert.deepEqual(storedSales.map((sale) => [sale.channelRefNo, sale.status]), [["2411ABC", "CANCELLED"], ["2411ABC", "ACTIVE"]]);
});

test("the same order number on another channel is not a duplicate", { skip: moduleMocksUnavailable }, async () => {
  storedSales = [{ id: "sale-lz", channel: "LAZADA", channelRefNo: "2411ABC", status: "ACTIVE" }];
  const { createSale } = await import("../actions");
  assert.equal((await createSale(marketplaceForm("2411ABC"))).success, true);
});

test("updateSale pre-check looks at ACTIVE sales only, with the normalized number", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  storedSales = [{ id: "sale-other", channel: "SHOPEE", channelRefNo: "2411XYZ", status: "ACTIVE" }];
  assert.deepEqual(await updateSale("saleedit", marketplaceForm(" 2411xyz ", "2026-11-10")), { error: DUPLICATE_MESSAGE });
  const preCheck = dbCalls.find((call) => call.method === "sale.findFirst")?.args as { where: Record<string, unknown> };
  assert.deepEqual(preCheck.where, { channel: "SHOPEE", channelRefNo: "2411XYZ", status: "ACTIVE", id: { not: "saleedit" } });

  storedSales = [{ id: "sale-other", channel: "SHOPEE", channelRefNo: "2411XYZ", status: "CANCELLED" }];
  dbCalls.length = 0;
  txCalls.length = 0;
  assert.deepEqual(await updateSale("saleedit", marketplaceForm(" 2411xyz ", "2026-11-10")), { success: true });
  const header = txCalls.find((call) => call.method === "sale.update")?.args as { data: { channelRefNo: string } };
  assert.equal(header.data.channelRefNo, "2411XYZ");
});

test("updateSale maps a concurrent duplicate on the M9 index to the Thai message", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  // The pre-check saw nothing; another sale took the number before the header update.
  dbOverrides.sale = { findUnique: async () => existingSale, findFirst: async () => null };
  storedSales = [{ id: "sale-other", channel: "SHOPEE", channelRefNo: "2411XYZ", status: "ACTIVE" }];
  assert.deepEqual(await updateSale("saleedit", marketplaceForm("2411xyz", "2026-11-10")), { error: DUPLICATE_MESSAGE });
});
