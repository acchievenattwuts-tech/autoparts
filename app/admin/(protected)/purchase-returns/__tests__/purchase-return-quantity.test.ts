import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";

import {
  buildPurchaseReturnQuantityExceededMessage,
  computePurchaseLinesRemaining,
  findPurchaseReturnQuantityExcess,
} from "../purchase-return-quantity";

// I2 (owner 2026-11-12): a RETURN that references a purchase may not send back more than the purchase
// holds — the credit-note rule (sum of the source's other ACTIVE RETURN documents + this request ≤ the
// purchased quantity, per product). The form prefills what is left (0 once fully returned).
// I7: create/update lock the referenced Purchase row(s) FOR UPDATE, sorted by id, before reading them.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type Row = Record<string, unknown>;

const QTY_EXCEEDED_ALL_RETURNED = "สินค้า P1 คอยล์เย็น คืนได้อีกไม่เกิน 0 ชิ้น ตามใบซื้อ RR26110001";

// ── Pure rule ───────────────────────────────────────────────────────────────

const purchased = new Map([["prod-1", 10]]);

test("rule: the first return of 10 of 10 fits; a second return of the same purchase does not (0 left)", () => {
  assert.equal(findPurchaseReturnQuantityExcess({
    purchasedBaseQtyByProductId: purchased, returnedBaseQtyByProductId: new Map(),
    requests: [{ productId: "prod-1", requestedBaseQty: 10 }],
  }), null);
  assert.deepEqual(findPurchaseReturnQuantityExcess({
    purchasedBaseQtyByProductId: purchased, returnedBaseQtyByProductId: new Map([["prod-1", 10]]),
    requests: [{ productId: "prod-1", requestedBaseQty: 1 }],
  }), { productId: "prod-1", requestIndex: 0, remainingBaseQty: 0 });
});

test("rule: lines of one product add up; the credit-note tolerance applies; products not on the purchase are not checked", () => {
  const returned = new Map([["prod-1", 6]]);
  const check = (requests: { productId: string; requestedBaseQty: number }[]) =>
    findPurchaseReturnQuantityExcess({ purchasedBaseQtyByProductId: purchased, returnedBaseQtyByProductId: returned, requests });
  assert.equal(check([{ productId: "prod-1", requestedBaseQty: 2 }, { productId: "prod-1", requestedBaseQty: 2 }]), null);
  assert.deepEqual(check([{ productId: "prod-9", requestedBaseQty: 99 }, { productId: "prod-1", requestedBaseQty: 3 },
    { productId: "prod-1", requestedBaseQty: 2 }]), { productId: "prod-1", requestIndex: 1, remainingBaseQty: 4 });
  assert.equal(check([{ productId: "prod-1", requestedBaseQty: 4.00005 }]), null);
  assert.equal(check([{ productId: "prod-9", requestedBaseQty: 1000 }]), null);
});

test("message: names the product, the quantity left in the line's unit and the purchase", () => {
  assert.equal(buildPurchaseReturnQuantityExceededMessage({
    productLabel: "P1 คอยล์เย็น", remainingBaseQty: 0, unitScale: 1, unitName: "ชิ้น", purchaseNo: "RR26110001",
  }), QTY_EXCEEDED_ALL_RETURNED);
  assert.equal(buildPurchaseReturnQuantityExceededMessage({
    productLabel: "P1 คอยล์เย็น", remainingBaseQty: 24, unitScale: 12, unitName: "ลัง", purchaseNo: "RR26110001",
  }), "สินค้า P1 คอยล์เย็น คืนได้อีกไม่เกิน 2 ลัง ตามใบซื้อ RR26110001");
});

test("prefill: nothing returned keeps every line as before; 10 of 10 returned leaves 0", () => {
  const lines = [{ productId: "prod-1", baseQty: 10, lots: [] }];
  assert.deepEqual(computePurchaseLinesRemaining(lines, []), [{ returnedBaseQty: 0, remainingBaseQty: 10, lots: [] }]);
  assert.deepEqual(computePurchaseLinesRemaining(lines, [{ productId: "prod-1", baseQty: 10, lots: [] }]),
    [{ returnedBaseQty: 10, remainingBaseQty: 0, lots: [] }]);
});

test("prefill: returns consume lines of a product in order, and the lot they took first", () => {
  const lines = [
    { productId: "prod-1", baseQty: 10, lots: [{ lotNo: "L1", baseQty: 6 }, { lotNo: "L2", baseQty: 4 }] },
    { productId: "prod-1", baseQty: 5, lots: [{ lotNo: "L3", baseQty: 5 }] },
    { productId: "prod-2", baseQty: 3, lots: [] },
  ];
  assert.deepEqual(computePurchaseLinesRemaining(lines, [{ productId: "prod-1", baseQty: 3, lots: [{ lotNo: "L1", baseQty: 3 }] }]), [
    { returnedBaseQty: 3, remainingBaseQty: 7, lots: [{ lotIndex: 0, baseQty: 3 }, { lotIndex: 1, baseQty: 4 }] },
    { returnedBaseQty: 0, remainingBaseQty: 5, lots: [] },
    { returnedBaseQty: 0, remainingBaseQty: 3, lots: [] },
  ]);
  // 12 returned from another lot: the first line is used up, 3 of the second is left (lot rows trimmed to it).
  assert.deepEqual(computePurchaseLinesRemaining(lines, [{ productId: "prod-1", baseQty: 12, lots: [{ lotNo: "LX", baseQty: 12 }] }]).slice(0, 2), [
    { returnedBaseQty: 10, remainingBaseQty: 0, lots: [] },
    { returnedBaseQty: 2, remainingBaseQty: 3, lots: [{ lotIndex: 0, baseQty: 3 }] },
  ]);
});

// ── createPurchaseReturn / updatePurchaseReturn / getPurchaseDetail ─────────

const makeClient = (overrides: () => ModelOverrides, calls: Call[], rawLog: Array<{ sql: string; values: unknown[] }>) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw") return async () => 0;
        if (modelName === "$queryRaw") {
          return async (query: { sql: string; values: unknown[] }) => {
            rawLog.push({ sql: query.sql, values: query.values });
            return /FROM "PurchaseReturn"/.test(query.sql) ? [{ status: "ACTIVE", updatedAt: UPDATED_AT }] : [];
          };
        }
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
                return { id: `${modelName}-id` };
              };
            },
          },
        );
      },
    },
  );

const UPDATED_AT = new Date("2026-11-12T03:00:00.000Z");
const product = { code: "P1", name: "คอยล์เย็น" };

let txOverrides: ModelOverrides = {};
let dbOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const rawLog: Array<{ sql: string; values: unknown[] }> = [];
const criticalReports: unknown[] = [];
const stockWrites: unknown[] = [];
/** Lines of ACTIVE RETURN documents already saved against po-1 (purchaseReturnId = the document). */
let priorReturnLines: Array<{ purchaseReturnId: string; productId: string; qty: Prisma.Decimal }> = [];
/** The stored return an edit reads before the transaction. */
let storedReturn: Row = {};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls, rawLog);
  await mock.module("@/lib/db", {
    namedExports: { ...realDb, db: makeClient(() => dbOverrides, [], []), dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx) },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: { ...realAuth, requirePermission: async () => ({ user: { id: "user-1", name: "Tester", permissions: [] } }) },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: { ...realAudit, getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: { ...realErrorReporting, reportCriticalError: async (error: unknown) => { criticalReports.push(error); } },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", { namedExports: { ...realDocNumber, generatePurchaseReturnNo: async () => "PR26111200002" } });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async (_tx: unknown, input: unknown) => { stockWrites.push(input); return "sc-out"; },
      recalculateStockCard: async () => undefined,
    },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: { ...realAmountRemain, recalculatePurchaseReturnAmountRemain: async () => undefined },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", { namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined } });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

const sourcePurchase = (id: string) => ({
  id, status: "ACTIVE", supplierId: "sup-1", purchaseNo: id === "po-1" ? "RR26110001" : "RR26110009",
  vatType: "NO_VAT", vatRate: 0, taxInvoiceDate: null, items: [{ id: "pi-1", productId: "prod-1" }],
});

beforeEach(() => {
  for (const list of [txCalls, rawLog, criticalReports, stockWrites]) list.length = 0;
  priorReturnLines = [];
  storedReturn = {
    id: "pr1", returnNo: "PR26111200001", returnDate: new Date("2026-11-11T17:00:00.000Z"), status: "ACTIVE",
    updatedAt: UPDATED_AT, createdAt: UPDATED_AT, purchaseId: "po-1", purchase: { vatType: "NO_VAT", vatRate: 0, taxInvoiceDate: null },
    claimId: null, supplierId: "sup-1", supplier: null, type: "RETURN", settlementType: "SUPPLIER_CREDIT",
    vatType: "NO_VAT", vatRate: 0, taxInvoiceNo: null, taxInvoiceDate: null, note: null,
    items: [{ id: "pri-1", productId: "prod-1", qty: new Prisma.Decimal(2), costPrice: 50, showQty: 2, showUnitName: "ชิ้น",
      moreDetail: null, lotItems: [], product }],
  };
  dbOverrides = {
    purchaseReturn: { findUnique: async () => storedReturn },
    supplierPaymentItem: { findMany: async () => [] },
  };
  txOverrides = {
    purchase: { findUnique: async (args) => sourcePurchase((args as { where: { id: string } }).where.id) },
    purchaseItem: { findMany: async () => [{ productId: "prod-1", quantity: new Prisma.Decimal(10), product }] },
    purchaseReturnItem: {
      findMany: async (args) => {
        const excluded = (args as { where: { purchaseReturn: { id?: { not: string } } } }).where.purchaseReturn.id?.not;
        return priorReturnLines.filter((line) => line.purchaseReturnId !== excluded);
      },
    },
    purchaseReturn: { create: async () => ({ id: "pr-new" }), findUnique: async () => ({ updatedAt: UPDATED_AT }) },
    productUnit: { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] },
    product: { findMany: async () => [{ id: "prod-1", avgCost: 50, costPrice: 50, inventoryTracking: "TRACKED", isLotControl: false }] },
  };
});

const returnForm = (qty: number, fields: Record<string, string> = {}): FormData => {
  const form = new FormData();
  const all: Record<string, string> = {
    returnDate: "2026-11-12", supplierId: "sup-1", purchaseId: "po-1", type: "RETURN", settlementType: "SUPPLIER_CREDIT",
    vatType: "NO_VAT", vatRate: "0", updatedAt: UPDATED_AT.toISOString(),
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty, costPrice: 50, lotItems: [] }]),
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) form.set(key, value);
  return form;
};

const writes = (): string[] =>
  txCalls.map((call) => call.method).filter((method) => /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/.test(method));

const PURCHASE_LOCK = /^SELECT "id" FROM "Purchase" WHERE "id" IN \(\?(,\?)*\) ORDER BY "id" FOR UPDATE$/;

test("create: return 10 of 10, then a second return of the same purchase is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  assert.equal((await createPurchaseReturn(returnForm(10))).success, true, String(criticalReports[0] ?? ""));
  assert.equal(stockWrites.length, 1);

  priorReturnLines = [{ purchaseReturnId: "pr-first", productId: "prod-1", qty: new Prisma.Decimal(10) }];
  txCalls.length = 0;
  stockWrites.length = 0;
  rawLog.length = 0;
  const second = await createPurchaseReturn(returnForm(10));
  assert.deepEqual(second, { error: QTY_EXCEEDED_ALL_RETURNED });
  assert.deepEqual(writes(), []);
  assert.equal(stockWrites.length, 0);
  assert.equal(criticalReports.length, 0);
  // I7: the referenced purchase is locked first, before its status is read.
  assert.match(rawLog[0]?.sql ?? "", PURCHASE_LOCK);
  assert.deepEqual(rawLog[0]?.values, ["po-1"]);
  assert.equal(txCalls[0]?.method, "purchase.findUnique");
});

test("create: a partial return names what is left; only ACTIVE RETURN documents of this purchase are counted", { skip: moduleMocksUnavailable }, async () => {
  priorReturnLines = [{ purchaseReturnId: "pr-first", productId: "prod-1", qty: new Prisma.Decimal(6) }];
  const { createPurchaseReturn } = await import("../actions");
  assert.deepEqual(await createPurchaseReturn(returnForm(5)), {
    error: "สินค้า P1 คอยล์เย็น คืนได้อีกไม่เกิน 4 ชิ้น ตามใบซื้อ RR26110001",
  });
  const query = txCalls.find((call) => call.method === "purchaseReturnItem.findMany")?.args as { where: Row };
  assert.deepEqual(query.where, { productId: { in: ["prod-1"] }, purchaseReturn: { purchaseId: "po-1", status: "ACTIVE", type: "RETURN" } });
  assert.equal((await createPurchaseReturn(returnForm(4))).success, true);
});

test("create: DISCOUNT/OTHER returns and returns without a purchase are not checked (unchanged)", { skip: moduleMocksUnavailable }, async () => {
  priorReturnLines = [{ purchaseReturnId: "pr-first", productId: "prod-1", qty: new Prisma.Decimal(10) }];
  const { createPurchaseReturn } = await import("../actions");
  assert.equal((await createPurchaseReturn(returnForm(10, { type: "DISCOUNT" }))).success, true, String(criticalReports[0] ?? ""));
  assert.ok(!txCalls.some((call) => call.method === "purchaseReturnItem.findMany"));

  txCalls.length = 0;
  rawLog.length = 0;
  assert.equal((await createPurchaseReturn(returnForm(10, { purchaseId: "" }))).success, true);
  assert.ok(!txCalls.some((call) => call.method === "purchaseReturnItem.findMany" || call.method === "purchase.findUnique"));
  assert.ok(!rawLog.some((query) => PURCHASE_LOCK.test(query.sql)), "no purchase, no Purchase lock");
});

test("update: the edited return is not counted against itself", { skip: moduleMocksUnavailable }, async () => {
  // This return holds 2; another holds 8 → 10 of 10 returned. Editing it to 2 still fits; to 3 does not.
  priorReturnLines = [
    { purchaseReturnId: "pr1", productId: "prod-1", qty: new Prisma.Decimal(2) },
    { purchaseReturnId: "pr-other", productId: "prod-1", qty: new Prisma.Decimal(8) },
  ];
  const { updatePurchaseReturn } = await import("../actions");
  assert.deepEqual(await updatePurchaseReturn("pr1", returnForm(2, { note: "แก้หมายเหตุ" })), { success: true }, String(criticalReports[0] ?? ""));
  const query = txCalls.find((call) => call.method === "purchaseReturnItem.findMany")?.args as { where: { purchaseReturn: Row } };
  assert.deepEqual(query.where.purchaseReturn.id, { not: "pr1" });

  txCalls.length = 0;
  assert.deepEqual(await updatePurchaseReturn("pr1", returnForm(3)), {
    error: "สินค้า P1 คอยล์เย็น คืนได้อีกไม่เกิน 2 ชิ้น ตามใบซื้อ RR26110001",
  });
  assert.deepEqual(writes(), []);
  assert.equal(criticalReports.length, 0);
});

test("update: locks PurchaseReturn, then the stored and new purchases sorted by id, then products", { skip: moduleMocksUnavailable }, async () => {
  storedReturn = { ...storedReturn, purchaseId: "po-9" };
  const { updatePurchaseReturn } = await import("../actions");
  assert.deepEqual(await updatePurchaseReturn("pr1", returnForm(2)), { success: true }, String(criticalReports[0] ?? ""));
  const locks = rawLog.filter((query) => /FOR UPDATE/.test(query.sql));
  assert.match(locks[0]?.sql ?? "", /FROM "PurchaseReturn"/);
  assert.match(locks[1]?.sql ?? "", PURCHASE_LOCK);
  assert.deepEqual(locks[1]?.values, ["po-1", "po-9"]);
  assert.match(locks[2]?.sql ?? "", /FROM "Product"/);
});

// ── getPurchaseDetail ──────────────────────────────────────────────────────

const purchaseDetailRow = (purchaseReturns: Row[]) => ({
  vatType: "NO_VAT", vatRate: 0, taxInvoiceDate: null, purchaseReturns,
  items: [{
    productId: "prod-1", quantity: new Prisma.Decimal(10), costPrice: new Prisma.Decimal(50), showQty: new Prisma.Decimal(10),
    showUnitName: "ชิ้น", showPricePerUnit: new Prisma.Decimal(50), unitScale: new Prisma.Decimal(1),
    product: { id: "prod-1", code: "P1", name: "คอยล์เย็น", description: null, avgCost: new Prisma.Decimal(50), costPrice: new Prisma.Decimal(50),
      inventoryTracking: "TRACKED", isLotControl: true, isActive: true, purchaseUnitName: "ชิ้น", category: { name: "แอร์" }, brand: null,
      aliases: [], units: [{ name: "ชิ้น", scale: new Prisma.Decimal(1), isBase: true }] },
    lotItems: [
      { lotNo: "L1", qty: new Prisma.Decimal(6), unitCost: new Prisma.Decimal(50), mfgDate: null, expDate: null },
      { lotNo: "L2", qty: new Prisma.Decimal(4), unitCost: new Prisma.Decimal(50), mfgDate: null, expDate: null },
    ],
  }],
});

const lotRow = (lotNo: string, qty: number) => ({ lotNo, qty, unitCost: 50, mfgDate: "", expDate: "" });

test("getPurchaseDetail: nothing returned prefills the full purchase exactly as before", { skip: moduleMocksUnavailable }, async () => {
  let query: { select: { purchaseReturns: { where: Row } } } | undefined;
  dbOverrides.purchase = { findUnique: async (args) => { query = args as typeof query; return purchaseDetailRow([]); } };
  const { getPurchaseDetail } = await import("../actions");
  const detail = await getPurchaseDetail("po-1");
  assert.deepEqual(detail?.items, [{ productId: "prod-1", unitName: "ชิ้น", qty: 10, costPrice: 50, lotItems: [lotRow("L1", 6), lotRow("L2", 4)] }]);
  assert.deepEqual(query?.select.purchaseReturns.where, { status: "ACTIVE", type: "RETURN" });
});

test("getPurchaseDetail: after 10 of 10 returned the form prefills 0; a partial return prefills what is left", { skip: moduleMocksUnavailable }, async () => {
  const returned = (qty: number, lots: Array<{ lotNo: string; qty: number }>) => ({
    items: [{ productId: "prod-1", qty: new Prisma.Decimal(qty), lotItems: lots.map((lot) => ({ lotNo: lot.lotNo, qty: new Prisma.Decimal(lot.qty) })) }],
  });
  const { getPurchaseDetail } = await import("../actions");

  dbOverrides.purchase = { findUnique: async () => purchaseDetailRow([returned(10, [{ lotNo: "L1", qty: 6 }, { lotNo: "L2", qty: 4 }])]) };
  assert.deepEqual((await getPurchaseDetail("po-1"))?.items.map((item) => [item.qty, item.lotItems]), [[0, []]]);

  dbOverrides.purchase = { findUnique: async () => purchaseDetailRow([returned(3, [{ lotNo: "L1", qty: 3 }])]) };
  assert.deepEqual((await getPurchaseDetail("po-1"))?.items.map((item) => [item.qty, item.lotItems]), [[7, [lotRow("L1", 3), lotRow("L2", 4)]]]);
});

test("getPurchaseDetail: the edit form excludes the return being edited", { skip: moduleMocksUnavailable }, async () => {
  let query: { select: { purchaseReturns: { where: Row } } } | undefined;
  dbOverrides.purchase = { findUnique: async (args) => { query = args as typeof query; return purchaseDetailRow([]); } };
  const { getPurchaseDetail } = await import("../actions");
  await getPurchaseDetail("po-1", "pr1");
  assert.deepEqual(query?.select.purchaseReturns.where, { status: "ACTIVE", type: "RETURN", id: { not: "pr1" } });
  await getPurchaseDetail("po-1", "not a valid id!");
  assert.deepEqual(query?.select.purchaseReturns.where, { status: "ACTIVE", type: "RETURN" });
});
