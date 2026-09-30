import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";
import { getThailandDateKey, getThailandMonthKey, parseDateOnlyToDate } from "@/lib/th-date";
import { calcItemSubtotal, calcVat, type VatType } from "@/lib/vat";
import { PURCHASE_RETURN_TYPE_CHANGE_MESSAGE } from "../purchase-return-presentation";
import { resolvePurchaseReturnCancelLock } from "../purchase-return-cancel-preview";
import { needsPurchaseReturnEditPreview, resolvePurchaseReturnEditLock } from "../purchase-return-edit-preview";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PeriodLockFormSection } from "@/app/admin/_components/PeriodLockControls";
import { PERIOD_LOCK_REASON_LABEL, type PeriodLockView } from "@/lib/period-lock-view";

// V8 (owner approved 2026-09-30, W1–W7): createPurchaseReturn / updatePurchaseReturn / cancelPurchaseReturn post,
// repost and reverse the ลดราคาซื้อ value-only rows of a DISCOUNT/OTHER return. The real allowance module, restatement
// planner, guard and month lock run here; the stock writer, profit facts and side-effect modules are recorded.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type Where = Record<string, unknown>;
type StockWrite = Record<string, unknown>;

const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const day = (key: string): Date => parseDateOnlyToDate(key);
const TODAY = day(getThailandDateKey());
const POSTED = day("2026-09-29");
const UPDATED_AT = new Date("2026-09-29T02:00:00.000Z");

const txCalls: Call[] = [];
const stockWrites: StockWrite[] = [];
const recalculated: string[][] = [];
const executed: string[] = [];
const saleFacts: string[] = [];
const allowanceFacts: string[] = [];
const audits: Array<Record<string, unknown>> = [];
const alerts: Array<Record<string, unknown>> = [];
const criticalReports: unknown[] = [];
const lockMonths: string[][] = [];
let queryRawCalls = 0;
let createdItems = 0;
let onHand: number | null = 4;
let declared: Record<string, string> = {};
let registeredFrom: string | null = null;
let permissions: string[] = [];
let unitScale = 1;
let storedReturn: Record<string, unknown> = {};
let postedRows: Array<Record<string, unknown>> = [];
/** Date of the later sale SA26090002 (after the ลดราคาซื้อ posting); X4 moves it into another month. */
let laterSaleDate = day("2026-09-30");

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The SKU's stock card as the restatement planner reads it: 10 in @100, 6 sold, ลดราคาซื้อ -80, 2 sold at 80. */
const plannerRows = () => [
  { id: "rr", productId: "p-1", docNo: "RR26090001", referenceId: "pi-1", docDate: day("2026-09-20"), sorder: 1, source: "PURCHASE",
    qtyIn: D(10), qtyOut: D(0), priceIn: D(100), landedCost: D(0), usesReferenceCost: false, qtyBalance: D(10), priceBalance: D(100),
    priceOut: D(0), valueAdjustment: D(0), valuationEpoch: 0, costVariance: D(0) },
  { id: "sa1", productId: "p-1", docNo: "SA26090001", referenceId: "si-1", docDate: day("2026-09-21"), sorder: 2, source: "SALE",
    qtyIn: D(0), qtyOut: D(6), priceIn: D(0), landedCost: D(0), usesReferenceCost: false, qtyBalance: D(4), priceBalance: D(100),
    priceOut: D(100), valueAdjustment: D(0), valuationEpoch: 0, costVariance: D(0) },
  ...postedRows.map((row) => ({ ...row, docNo: "PR26090001", source: "PURCHASE_ALLOWANCE", sorder: 3, qtyIn: D(0), qtyOut: D(0),
    priceIn: D(0), landedCost: D(0), usesReferenceCost: false, qtyBalance: D(4), priceBalance: D(80), priceOut: D(100),
    valueAdjustment: D(Number(row.valueAdjustment)), costVariance: D(Number(row.costVariance)) })),
  { id: "sa2", productId: "p-1", docNo: "SA26090002", referenceId: "si-2", docDate: laterSaleDate, sorder: 4, source: "SALE",
    qtyIn: D(0), qtyOut: D(2), priceIn: D(0), landedCost: D(0), usesReferenceCost: false, qtyBalance: D(2), priceBalance: D(80),
    priceOut: D(80), valueAdjustment: D(0), valuationEpoch: 0, costVariance: D(0) },
];

const saleItems = () => [
  { id: "si-2", saleId: "sale-2", productId: "p-1", quantity: D(2), costPrice: D(80),
    sale: { saleNo: "SA26090002", saleDate: laterSaleDate, status: "ACTIVE" } },
];

const txOverrides = (): ModelOverrides => ({
  purchaseReturn: {
    findUnique: async () => ({ updatedAt: UPDATED_AT }),
    create: async () => ({ id: "pr-new" }),
  },
  purchaseReturnItem: { create: async () => ({ id: `pri-new-${++createdItems}` }) },
  productUnit: { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: unitScale }] },
  product: { findMany: async () => [{ id: "p-1", avgCost: 100, costPrice: 100, inventoryTracking: "TRACKED", isLotControl: false }] },
  purchase: { findUnique: async () => ({ id: "po-1", status: "ACTIVE", supplierId: "sup-1", purchaseNo: "RR26090001",
    vatType: "INCLUDING_VAT", vatRate: 7, taxInvoiceDate: day("2026-09-01") }) },
  siteContent: { findUnique: async () => (registeredFrom ? { value: registeredFrom } : null) },
  profitDistribution: { findMany: async (args) => {
    const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
    lockMonths.push(keys);
    return keys.filter((key) => declared[key]).map((key) => ({ activePeriodKey: key, distributionNo: declared[key] }));
  },
  // X4 cancel preview: is any month from the posting month on declared?
  findFirst: async (args) => {
    const from = (args as { where: { activePeriodKey: { gte: string } } }).where.activePeriodKey.gte;
    return Object.keys(declared).some((key) => key >= from) ? { id: "pd-1" } : null;
  } },
  stockCard: {
    findFirst: async (args) => {
      const where = (args as { where: Where }).where;
      if (isObject(where.docDate) && "gt" in where.docDate) return null;
      if (where.OR) return onHand === null ? null : { qtyBalance: D(onHand) };
      return { valuationEpoch: 0 };
    },
    findMany: async (args) => {
      const where = (args as { where: Where }).where;
      if (where.docNo && where.source === "PURCHASE_ALLOWANCE") return postedRows;
      if (isObject(where.productId) && "in" in where.productId) return plannerRows();
      return [];
    },
  },
  warrantyClaim: { findUnique: async () => ({ id: "claim-1", claimNo: "WCM26090001", status: "SENT_TO_SUPPLIER",
    supplierId: "sup-1", warrantyId: "w-1", warranty: { productId: "p-1" } }) },
  warranty: { findUnique: async () => ({ productId: "p-1", lotNo: null, product: { avgCost: 100 }, saleItem: null }) },
  saleItem: { findMany: async (args) => {
    const where = (args as { where: Where }).where;
    const ids = isObject(where.id) ? (where.id.in as string[]) : [];
    return saleItems().filter((item) => ids.includes(item.id));
  } },
});

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) => new Proxy({}, {
  get: (_target, modelName: string) => {
    if (modelName === "$queryRaw") {
      return async () => { queryRawCalls += 1; return [{ status: "ACTIVE", returnDate: storedReturn.returnDate }]; };
    }
    if (modelName === "$executeRaw") {
      // Tagged templates pass the strings array; Prisma.sql(...) passes an object with `sql`.
      return async (query: readonly string[] | { sql?: string }) => {
        executed.push(Array.isArray(query) ? query.join("?") : (query as { sql?: string }).sql ?? "");
        return 0;
      };
    }
    return new Proxy({}, {
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
    });
  },
});

/** Every pre-read of the return (edit, cancel, audit snapshot) sees the stored document. */
const dbOverrides = (): ModelOverrides => ({
  purchaseReturn: { findUnique: async () => ({ ...storedReturn, supplier: null }) },
});

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(txOverrides, txCalls);
  await mock.module("@/lib/db", { namedExports: { ...realDb, db: makeClient(dbOverrides, []),
    dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx) } });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", { namedExports: { ...realStockCard,
    writeStockCard: async (_tx: unknown, input: StockWrite) => { stockWrites.push(input); return `sc-${stockWrites.length}`; },
    recalculateStockCard: async (_tx: unknown, productId: string) => { recalculated.push([productId]); },
    recalculateStockCardMany: async (_tx: unknown, productIds: Iterable<string>) => { recalculated.push([...productIds]); },
  } });
  const realFacts = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", { namedExports: { ...realFacts,
    rebuildSaleProfitFacts: async (_tx: unknown, saleId: string) => { saleFacts.push(saleId); },
    rebuildCreditNoteProfitFacts: async () => undefined,
    rebuildPurchaseAllowanceProfitFacts: async (_tx: unknown, id: string) => { allowanceFacts.push(id); },
  } });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", { namedExports: { ...realAuth,
    requirePermission: async () => ({ user: { id: "user-1", name: "เจ้าของร้าน", permissions } }) } });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", { namedExports: { ...realAudit, getRequestContext: async () => ({}),
    safeWriteAuditLog: async (input: Record<string, unknown>) => { audits.push(input); } } });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", { namedExports: { ...realNotifications,
    safeNotifyPeriodLockOverride: async (input: Record<string, unknown>) => { alerts.push(input); } } });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", { namedExports: { ...realErrorReporting,
    reportCriticalError: async (error: unknown) => { criticalReports.push(error); } } });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", { namedExports: { ...realDocNumber, generatePurchaseReturnNo: async () => "PR26090002" } });
  for (const [path, names] of [["@/lib/amount-remain", ["recalculatePurchaseReturnAmountRemain"]],
    ["@/lib/cash-bank", ["clearCashBankSourceMovements", "replaceCashBankSourceMovements"]],
    ["@/lib/document-payments", ["clearDocumentPayments", "replaceDocumentPayments"]]] as const) {
    const real = await import(path);
    await mock.module(path, { namedExports: { ...real, ...Object.fromEntries(names.map((name) => [name, async () => undefined])) } });
  }
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined, revalidateTag: () => undefined } });
});

const storedDiscount = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "pr1", returnNo: "PR26090001", returnDate: day("2026-08-20"), createdAt: new Date("2026-09-29T03:00:00.000Z"),
  status: "ACTIVE", updatedAt: UPDATED_AT, purchaseId: null, purchase: null, claimId: null, supplierId: "sup-1",
  type: "DISCOUNT", settlementType: "SUPPLIER_CREDIT", vatType: "NO_VAT", vatRate: 0, taxInvoiceNo: null, taxInvoiceDate: null,
  note: null, totalAmount: 200, amountRemain: 200, subtotalAmount: 200, vatAmount: 0,
  items: [{ id: "pri-1", productId: "p-1", qty: 10, costPrice: 20, showQty: 10, showUnitName: "ชิ้น", moreDetail: null, lotItems: [],
    amount: 200, subtotalAmount: 200, detail: "คืน 10 ชิ้น", product: { code: "P1", name: "ไส้กรอง" } }],
  ...overrides,
});
const POSTED_ROW = { id: "sc-pa", productId: "p-1", docDate: POSTED, valuationEpoch: 1, referenceId: "pri-1",
  valueAdjustment: D(-80), costVariance: D(-120) };

beforeEach(() => {
  for (const list of [txCalls, stockWrites, recalculated, executed, saleFacts, allowanceFacts, audits, alerts, criticalReports, lockMonths]) {
    list.length = 0;
  }
  queryRawCalls = 0; createdItems = 0; onHand = 4; declared = {}; registeredFrom = null; unitScale = 1;
  laterSaleDate = day("2026-09-30");
  permissions = ["purchase_returns.create", "purchase_returns.update", "purchase_returns.cancel"];
  storedReturn = storedDiscount();
  postedRows = [POSTED_ROW];
});

const form = (fields: Record<string, string>, items: Array<Record<string, unknown>>): FormData => {
  const data = new FormData();
  const all: Record<string, string> = { returnDate: "2026-09-20", supplierId: "sup-1", type: "DISCOUNT",
    settlementType: "SUPPLIER_CREDIT", vatType: "NO_VAT", vatRate: "0", updatedAt: UPDATED_AT.toISOString(),
    items: JSON.stringify(items), ...fields };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
};
const discountLine = (costPrice = 20, qty = 10) => [{ productId: "p-1", unitName: "ชิ้น", qty, costPrice }];
/** An edit of the stored return (dated 2026-08-20, an open month in these tests). */
const editForm = (fields: Record<string, string>, items: Array<Record<string, unknown>>): FormData =>
  form({ returnDate: "2026-08-20", ...fields }, items);
const created = (): Record<string, unknown> =>
  (txCalls.find((call) => call.method === "purchaseReturn.create")?.args as { data: Record<string, unknown> }).data;
const itemData = (): Array<Record<string, unknown>> => txCalls.filter((call) => call.method === "purchaseReturnItem.create")
  .map((call) => (call.args as { data: Record<string, unknown> }).data);
const allowanceWrite = (overrides: Record<string, unknown>): Record<string, unknown> => ({ productId: "p-1", docNo: "PR26090002",
  docDate: TODAY, source: "PURCHASE_ALLOWANCE", qtyIn: 0, qtyOut: 0, priceIn: 0, valuationEpoch: 1, referenceId: "pri-new-1",
  ...overrides });
const deletes = (): unknown[] => txCalls.filter((call) => call.method === "stockCard.deleteMany").map((call) => call.args);
const WRITE_METHOD = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

for (const type of ["DISCOUNT", "OTHER"]) {
  test(`create ${type} 20 x 10 (NO_VAT, not registered) with 4 on hand: stock value -80, variance -120 today, AP -200`,
    { skip: moduleMocksUnavailable }, async () => {
      const { createPurchaseReturn } = await import("../actions");
      const result = await createPurchaseReturn(form({ type }, discountLine()));
      assert.deepEqual(result, { success: true, returnNo: "PR26090002" }, String(criticalReports[0] ?? ""));
      assert.deepEqual([created().totalAmount, created().subtotalAmount, created().vatAmount, created().amountRemain,
        created().returnDate], [200, 200, 0, 200, day("2026-09-20")], "AP and the document date are unchanged");
      assert.deepEqual(stockWrites, [allowanceWrite({ valueAdjustment: -80, costVariance: -120,
        detail: "ลดราคาซื้อ · มูลค่าสต็อก -80.00 / ส่วนต่างต้นทุน -120.00" })]);
      assert.deepEqual(allowanceFacts, ["pr-new"]);
      assert.ok(lockMonths.some((keys) => keys.includes(getThailandMonthKey(TODAY))), "the posting month is locked-checked");
      const meta = audits[0]?.meta as { purchaseAllowance: { postingDate: string; inventoryAmount: number; varianceAmount: number } };
      assert.deepEqual([meta.purchaseAllowance.postingDate, meta.purchaseAllowance.inventoryAmount, meta.purchaseAllowance.varianceAmount],
        [getThailandDateKey(TODAY), -80, -120]);
    });
}

test("create against a recoverable INCLUDING_VAT purchase removes the pre-VAT 200 of 214; not registered removes 214",
  { skip: moduleMocksUnavailable }, async () => {
    const { createPurchaseReturn } = await import("../actions");
    const fields = { purchaseId: "po-1", vatType: "INCLUDING_VAT", vatRate: "7", taxInvoiceNo: "CN-S-1", taxInvoiceDate: "2026-09-20" };
    registeredFrom = "2026-01-01";
    assert.equal((await createPurchaseReturn(form(fields, discountLine(21.4)))).success, true, String(criticalReports[0] ?? ""));
    assert.deepEqual([created().totalAmount, created().subtotalAmount, created().vatAmount], [214, 200, 14]);
    assert.deepEqual([stockWrites[0].valueAdjustment, stockWrites[0].costVariance], [-80, -120]);
    txCalls.length = 0; stockWrites.length = 0; createdItems = 0;
    registeredFrom = null;
    assert.equal((await createPurchaseReturn(form(fields, discountLine(21.4)))).success, true);
    assert.deepEqual([stockWrites[0].valueAdjustment, stockWrites[0].costVariance], [-85.6, -128.4]);
  });

test("stock already 0: the whole 200 is variance, no inventory change", { skip: moduleMocksUnavailable }, async () => {
  onHand = 0;
  const { createPurchaseReturn } = await import("../actions");
  assert.equal((await createPurchaseReturn(form({}, discountLine()))).success, true);
  assert.deepEqual([stockWrites[0].valueAdjustment, stockWrites[0].costVariance], [0, -200]);
});

test("RETURN is unchanged: one RETURN_OUT row, no coverage read, no extra lock, only the return month checked",
  { skip: moduleMocksUnavailable }, async () => {
    const { createPurchaseReturn } = await import("../actions");
    const result = await createPurchaseReturn(form({ type: "RETURN", returnDate: "2026-08-20" }, discountLine()));
    assert.equal(result.success, true, String(criticalReports[0] ?? ""));
    assert.deepEqual(stockWrites, [{ productId: "p-1", docNo: "PR26090002", docDate: day("2026-08-20"), source: "RETURN_OUT",
      qtyIn: 0, qtyOut: 10, priceIn: 0, usesReferenceCost: false, detail: "คืน 10 ชิ้น", referenceId: "pri-new-1" }]);
    assert.deepEqual([itemData()[0].qty, itemData()[0].detail], [10, "คืน 10 ชิ้น"]);
    assert.deepEqual(lockMonths, [["2026-08"]]);
    assert.equal(queryRawCalls, 0);
    assert.equal(txCalls.filter((call) => call.method.startsWith("stockCard.")).length, 0);
    assert.deepEqual(allowanceFacts, []);
    assert.equal(audits[0]?.meta, undefined);
  });

test("W7: a fractional line stores its exact base quantity and shows 2 decimals; float noise is removed",
  { skip: moduleMocksUnavailable }, async () => {
    const { createPurchaseReturn } = await import("../actions");
    await createPurchaseReturn(form({ type: "RETURN", returnDate: "2026-08-20" }, discountLine(20, 2.5)));
    assert.deepEqual([itemData()[0].qty, itemData()[0].detail, stockWrites[0].qtyOut, stockWrites[0].detail],
      [2.5, "คืน 2.50 ชิ้น", 2.5, "คืน 2.50 ชิ้น"]);
    txCalls.length = 0; stockWrites.length = 0;
    unitScale = 0.1;
    await createPurchaseReturn(form({ type: "RETURN", returnDate: "2026-08-20" }, discountLine(20, 3)));
    assert.equal(itemData()[0].qty, 0.3, "0.1 x 3 is stored as 0.3, not 0.30000000000000004 or Math.round → 0");
  });

test("edit 20 → 10 per unit: reposted at the ORIGINAL date/position (-40 / -60) and the later sale restated 80 → 90",
  { skip: moduleMocksUnavailable }, async () => {
    const { updatePurchaseReturn } = await import("../actions");
    const result = await updatePurchaseReturn("pr1", editForm({}, discountLine(10)));
    assert.deepEqual(result, { success: true }, String(criticalReports[0] ?? ""));
    assert.deepEqual(deletes(), [{ where: { docNo: "PR26090001", source: "PURCHASE_ALLOWANCE" } }]);
    assert.deepEqual(stockWrites, [allowanceWrite({ docNo: "PR26090001", docDate: POSTED, valueAdjustment: -40, costVariance: -60,
      detail: "ลดราคาซื้อ · มูลค่าสต็อก -40.00 / ส่วนต่างต้นทุน -60.00" })]);
    assert.ok(executed.some((sql) => sql.includes("UPDATE \"SaleItem\"")), "the later sale's cost snapshot is restated");
    assert.deepEqual(saleFacts, ["sale-2"]);
    assert.deepEqual(allowanceFacts, ["pr1"]);
    assert.ok(lockMonths.some((keys) => keys.includes("2026-09")), "posting and restated months are lock-checked");
    const meta = audits[0]?.meta as { purchaseAllowance: { reversed: unknown; inventoryAmount: number;
      restatement: { saleCount: number; delta: number; saleNos: string[] } } };
    assert.deepEqual(meta.purchaseAllowance.reversed, { inventoryAmount: -80, varianceAmount: -120 });
    assert.equal(meta.purchaseAllowance.inventoryAmount, -40);
    assert.deepEqual([meta.purchaseAllowance.restatement.saleCount, meta.purchaseAllowance.restatement.delta,
      meta.purchaseAllowance.restatement.saleNos], [1, 20, ["SA26090002"]]);
  });

test("a locked posting month blocks a cost edit without the override; with it the edit runs, is audited and alerted",
  { skip: moduleMocksUnavailable }, async () => {
    declared = { "2026-09": "PD2026090001" };
    const { updatePurchaseReturn } = await import("../actions");
    const blocked = await updatePurchaseReturn("pr1", editForm({}, discountLine(10)));
    assert.ok(blocked.error?.includes("PD2026090001"), blocked.error);
    assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), [], "refused before any write");
    assert.deepEqual([stockWrites, executed.filter((sql) => sql.includes("UPDATE")), criticalReports], [[], [], []]);

    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    const reason = "ผู้ขายแก้ส่วนลดตามใบลดหนี้ใหม่";
    assert.deepEqual(await updatePurchaseReturn("pr1", editForm({ [PERIOD_LOCK_REASON_FIELD]: reason }, discountLine(10))), { success: true });
    assert.equal((audits[0]?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, reason);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].docNo, "PR26090001");
  });

test("a note-only edit leaves the posted rows untouched, even in a locked posting month", { skip: moduleMocksUnavailable }, async () => {
  declared = { "2026-09": "PD2026090001" };
  const { updatePurchaseReturn } = await import("../actions");
  assert.deepEqual(await updatePurchaseReturn("pr1", editForm({ note: "รอใบลดหนี้ตัวจริง" }, discountLine())), { success: true });
  assert.deepEqual([deletes(), stockWrites, saleFacts, allowanceFacts], [[], [], [], []]);
});

test("cancel reverses the rows, replays the SKU, restates the later sale 80 → 100 and deactivates the facts",
  { skip: moduleMocksUnavailable }, async () => {
    const { cancelPurchaseReturn } = await import("../actions");
    const data = new FormData();
    data.set("returnId", "pr1");
    assert.deepEqual(await cancelPurchaseReturn(data), { success: true }, String(criticalReports[0] ?? ""));
    assert.deepEqual(deletes(), [{ where: { docNo: "PR26090001", source: "PURCHASE_ALLOWANCE" } }]);
    assert.deepEqual(recalculated, [["p-1"]]);
    assert.ok(executed.some((sql) => sql.includes("UPDATE \"SaleItem\"")));
    assert.deepEqual(saleFacts, ["sale-2"]);
    const deactivation = txCalls.find((call) => call.method === "factProfit.updateMany")?.args as { where: Where; data: Where };
    assert.deepEqual(deactivation.where, { sourceType: "PURCHASE_COST_VARIANCE", sourceId: "pr1", isActive: true });
    assert.equal(deactivation.data.sourceStatus, "CANCELLED");
    const meta = audits[0]?.meta as { purchaseAllowance: { restatement: { delta: number } } };
    assert.equal(meta.purchaseAllowance.restatement.delta, 40);
  });

test("cancel in a locked posting month is refused without the override, before any write", { skip: moduleMocksUnavailable }, async () => {
  declared = { "2026-09": "PD2026090001" };
  const { cancelPurchaseReturn } = await import("../actions");
  const data = new FormData();
  data.set("returnId", "pr1");
  const result = await cancelPurchaseReturn(data);
  assert.ok(result.error?.includes("PD2026090001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual([recalculated, criticalReports], [[], []]);
});

test("an OTHER return settling a warranty claim keeps today's behaviour (no ลดราคาซื้อ) pending the owner's answer",
  { skip: moduleMocksUnavailable }, async () => {
    const { createPurchaseReturn } = await import("../actions");
    const result = await createPurchaseReturn(form({ type: "OTHER", claimId: "claim-1" }, discountLine()));
    assert.equal(result.success, true, String(criticalReports[0] ?? ""));
    assert.deepEqual([stockWrites, allowanceFacts, queryRawCalls], [[], [], 0]);
    assert.deepEqual(lockMonths, [["2026-09"]], "only the return date's month");
  });

// ─── X2 (owner 2026-09-30): line amounts from the exact quantity ─────────────────────────────────────────────────

for (const [qty, cost, expected] of [[0.5, 100, 50], [0.4, 250, 100]] as const) {
  test(`X2: a line of ${qty} x ${cost} is charged ${expected.toFixed(2)} (line, subtotal, total and AP), not the rounded quantity`,
    { skip: moduleMocksUnavailable }, async () => {
      const { createPurchaseReturn } = await import("../actions");
      const result = await createPurchaseReturn(form({ type: "RETURN", returnDate: "2026-08-20" }, discountLine(cost, qty)));
      assert.equal(result.success, true, String(criticalReports[0] ?? ""));
      assert.deepEqual([itemData()[0].qty, itemData()[0].amount, itemData()[0].subtotalAmount], [qty, expected, expected]);
      assert.deepEqual([created().subtotalAmount, created().vatAmount, created().totalAmount, created().amountRemain],
        [expected, 0, expected, expected]);
    });
}

test("X2: integer quantities keep byte-identical amounts, VAT, totals and AP (unit scale, VAT types, float noise)",
  { skip: moduleMocksUnavailable }, async () => {
    const { createPurchaseReturn } = await import("../actions");
    const cases: Array<{ scale: number; qty: number; cost: number; vatType: VatType }> = [
      { scale: 1, qty: 3, cost: 33.33, vatType: "EXCLUDING_VAT" },
      { scale: 12, qty: 2, cost: 125, vatType: "INCLUDING_VAT" },
      // 30 x 0.1 = 3.0000000000000004 base units in floating point.
      { scale: 0.1, qty: 30, cost: 5.55, vatType: "NO_VAT" },
    ];
    for (const { scale, qty, cost, vatType } of cases) {
      txCalls.length = 0; createdItems = 0; unitScale = scale;
      const vatRate = vatType === "NO_VAT" ? 0 : 7;
      const fields = { type: "RETURN", returnDate: "2026-08-20", vatType, vatRate: String(vatRate),
        ...(vatType === "NO_VAT" ? {} : { taxInvoiceNo: "CN-S-1", taxInvoiceDate: "2026-08-20" }) };
      const result = await createPurchaseReturn(form(fields, discountLine(cost, qty)));
      assert.equal(result.success, true, `${vatType}: ${String(criticalReports[0] ?? "")}`);
      // The formula before X2: Math.round(qtyInBase) x cost per base unit.
      const before = Math.round(qty * scale) * (cost / scale);
      const header = calcVat(before, vatType, vatRate);
      assert.equal(itemData()[0].amount, before, `${vatType} line amount`);
      assert.equal(itemData()[0].subtotalAmount, calcItemSubtotal(before, vatType, vatRate));
      assert.deepEqual([created().subtotalAmount, created().vatAmount, created().totalAmount, created().amountRemain],
        [header.subtotalAmount, header.vatAmount, header.netAmount, header.netAmount], `${vatType} totals and AP`);
    }
  });

test("X2: a fractional DISCOUNT line removes the exact 0.5 x 100 = 50 from stock cost", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  const result = await createPurchaseReturn(form({}, discountLine(100, 0.5)));
  assert.equal(result.success, true, String(criticalReports[0] ?? ""));
  assert.equal(created().totalAmount, 50);
  const meta = audits[0]?.meta as { purchaseAllowance: { lines: Array<{ costAmount: number }> } };
  assert.equal(meta.purchaseAllowance.lines[0].costAmount, 50);
  assert.equal(Number(stockWrites[0].valueAdjustment) + Number(stockWrites[0].costVariance), -50);
});

// ─── X3 (owner 2026-09-30): an edit keeps RETURN vs DISCOUNT/OTHER ──────────────────────────────────────────────

test("X3: an edit switching DISCOUNT → RETURN is refused before the transaction with the cancel-and-recreate message",
  { skip: moduleMocksUnavailable }, async () => {
    const { updatePurchaseReturn } = await import("../actions");
    const result = await updatePurchaseReturn("pr1", editForm({ type: "RETURN" }, discountLine()));
    assert.deepEqual(result, { error: PURCHASE_RETURN_TYPE_CHANGE_MESSAGE });
    assert.deepEqual([txCalls, stockWrites, audits, criticalReports], [[], [], [], []]);
    assert.equal(queryRawCalls, 0);
  });

for (const type of ["DISCOUNT", "OTHER"]) {
  test(`X3: an edit switching RETURN → ${type} is refused before the transaction`, { skip: moduleMocksUnavailable }, async () => {
    storedReturn = storedDiscount({ type: "RETURN" });
    postedRows = [];
    const { updatePurchaseReturn } = await import("../actions");
    assert.deepEqual(await updatePurchaseReturn("pr1", editForm({ type }, discountLine())), { error: PURCHASE_RETURN_TYPE_CHANGE_MESSAGE });
    assert.deepEqual([txCalls, stockWrites, audits], [[], [], []]);
  });
}

test("X3: DISCOUNT → OTHER stays allowed; the ลดราคาซื้อ row is reposted at its original date", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchaseReturn } = await import("../actions");
  const result = await updatePurchaseReturn("pr1", editForm({ type: "OTHER" }, discountLine()));
  assert.deepEqual(result, { success: true }, String(criticalReports[0] ?? ""));
  assert.deepEqual(stockWrites.map((write) => [write.source, write.docDate]), [["PURCHASE_ALLOWANCE", POSTED]]);
});

// ─── X4 (owner 2026-09-30): the cancel dialog previews every month the cancel touches ───────────────────────────

const cancelForm = (fields: Record<string, string> = {}): FormData => {
  const data = new FormData();
  data.set("returnId", "pr1");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

test("X4 preview: a later sale in a declared month is reported although the return and posting months are open",
  { skip: moduleMocksUnavailable }, async () => {
    laterSaleDate = day("2026-10-02");
    declared = { "2026-10": "PD2026100001" };
    const { previewPurchaseReturnCancel } = await import("../actions");
    const staff = await previewPurchaseReturnCancel("pr1");
    assert.equal(staff.error, undefined, String(staff.error));
    const lock = staff.preview?.periodLock ?? null;
    assert.ok(lock?.message.includes("PD2026100001"), lock?.message);
    assert.deepEqual([lock?.periodLabels.length, lock?.canOverride], [1, false]);
    assert.deepEqual(staff.preview?.restatement, { saleCount: 1, delta: 40 });
    assert.deepEqual(lockMonths.at(-1), ["2026-08", "2026-09", "2026-10"], "return, posting and restated sale months");
    assert.deepEqual(resolvePurchaseReturnCancelLock({ initial: null, preview: staff.preview ?? null, server: null }),
      { lock, asksReason: false, blocks: true }, "without the override the dialog blocks and says why");
    assert.deepEqual([txCalls.filter((call) => WRITE_METHOD.test(call.method)), stockWrites,
      executed.filter((sql) => sql.includes("UPDATE"))], [[], [], []], "the preview only reads");

    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    const owner = await previewPurchaseReturnCancel("pr1");
    assert.equal(owner.preview?.periodLock?.canOverride, true);
    const state = resolvePurchaseReturnCancelLock({ initial: null, preview: owner.preview ?? null, server: null });
    assert.deepEqual([state.asksReason, state.blocks], [true, false], "an owner is asked for the reason");
  });

test("X4 preview: nothing declared from the posting month on → no lock, no reason field, no replay",
  { skip: moduleMocksUnavailable }, async () => {
    laterSaleDate = day("2026-10-02");
    declared = { "2026-07": "PD2026070001" };
    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    const { previewPurchaseReturnCancel } = await import("../actions");
    const result = await previewPurchaseReturnCancel("pr1");
    assert.deepEqual(result, { preview: { periodLock: null, restatement: null } });
    assert.equal(resolvePurchaseReturnCancelLock({ initial: null, preview: result.preview ?? null, server: null }).asksReason, false);
    assert.equal(txCalls.some((call) => call.method === "saleItem.findMany"), false, "the restatement planner is skipped");
  });

test("X4 preview: a RETURN checks only its own month and reads no stock", { skip: moduleMocksUnavailable }, async () => {
  storedReturn = storedDiscount({ type: "RETURN" });
  declared = { "2026-08": "PD2026080001" };
  const { previewPurchaseReturnCancel } = await import("../actions");
  const result = await previewPurchaseReturnCancel("pr1");
  assert.ok(result.preview?.periodLock?.message.includes("PD2026080001"), String(result.error));
  assert.equal(result.preview?.restatement, null);
  assert.deepEqual(lockMonths, [["2026-08"]]);
  assert.equal(txCalls.some((call) => call.method.startsWith("stockCard.")), false);
});

test("X4 cancel: the server locks the same later-sale month — refused without a reason (returning the months), done with one",
  { skip: moduleMocksUnavailable }, async () => {
    laterSaleDate = day("2026-10-02");
    declared = { "2026-10": "PD2026100001" };
    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    const { cancelPurchaseReturn } = await import("../actions");
    const refused = await cancelPurchaseReturn(cancelForm());
    assert.ok(refused.error?.includes("PD2026100001"), refused.error);
    assert.deepEqual([refused.periodLock?.canOverride, refused.periodLock?.periodLabels.length], [true, 1]);
    assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), [], "refused before any write");

    const reason = "ซัพพลายเออร์ยกเลิกส่วนลดทั้งใบ";
    assert.deepEqual(await cancelPurchaseReturn(cancelForm({ [PERIOD_LOCK_REASON_FIELD]: reason })), { success: true });
    assert.equal((audits[0]?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, reason);
    assert.equal(alerts.length, 1);
  });

// ─── Y2 (owner 2026-09-30): the edit form asks for the reason when the repost restates a sale in a locked month ─────

/** The edit form's lock section as it renders for `lock` / `asksReason` (PurchaseReturnForm passes the resolved state). */
const renderEditLockSection = (lock: PeriodLockView | null, asksReason: boolean): string =>
  renderToStaticMarkup(createElement(PeriodLockFormSection, { lock, financialChange: asksReason }));

test("Y2 preview: a cost edit restating a later sale in a declared month is reported although the return and posting months are open",
  { skip: moduleMocksUnavailable }, async () => {
    laterSaleDate = day("2026-10-02");
    declared = { "2026-10": "PD2026100001" };
    const { previewPurchaseReturnUpdate } = await import("../actions");
    const staff = await previewPurchaseReturnUpdate("pr1", editForm({}, discountLine(10)));
    assert.equal(staff.error, undefined, String(staff.error));
    const lock = staff.preview?.periodLock ?? null;
    assert.ok(lock?.message.includes("PD2026100001"), lock?.message);
    assert.deepEqual([lock?.periodLabels.length, lock?.canOverride, staff.preview?.nonFinancial], [1, false, false]);
    assert.deepEqual(staff.preview?.restatement, { saleCount: 1, delta: 20 });
    assert.deepEqual(lockMonths.at(-1), ["2026-08", "2026-09", "2026-10"], "return, posting and restated sale months");
    assert.deepEqual(resolvePurchaseReturnEditLock({ initial: null, initialAsksReason: false, preview: staff.preview ?? null, server: null }),
      { lock, asksReason: false, blocks: true }, "without the override the save is blocked and the notice says why");
    assert.deepEqual([txCalls.filter((call) => WRITE_METHOD.test(call.method)), stockWrites,
      executed.filter((sql) => sql.includes("UPDATE")), criticalReports], [[], [], [], []], "the preview only reads");

    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    const owner = await previewPurchaseReturnUpdate("pr1", editForm({}, discountLine(10)));
    const state = resolvePurchaseReturnEditLock({ initial: null, initialAsksReason: false, preview: owner.preview ?? null, server: null });
    assert.deepEqual([state.lock?.canOverride, state.asksReason, state.blocks], [true, true, false], "an owner is asked for the reason");
    const html = renderEditLockSection(state.lock, state.asksReason);
    assert.ok(html.includes(PERIOD_LOCK_REASON_LABEL) && html.includes(`name="${PERIOD_LOCK_REASON_FIELD}"`), "the reason field renders");
  });

test("Y2: a remark-only edit needs no reason — no preview, nothing to ask, saved without one — even with a later sale locked",
  { skip: moduleMocksUnavailable }, async () => {
    laterSaleDate = day("2026-10-02");
    declared = { "2026-10": "PD2026100001" };
    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    assert.equal(needsPurchaseReturnEditPreview({ financialEdited: false, hasServerLock: false, reasonGiven: false }), false,
      "the form saves a remark-only edit straight away");
    const { previewPurchaseReturnUpdate, updatePurchaseReturn } = await import("../actions");
    const remark = editForm({ note: "รอใบลดหนี้ตัวจริง" }, [{ ...discountLine()[0], moreDetail: "กล่องบุบ" }]);
    const preview = await previewPurchaseReturnUpdate("pr1", remark);
    assert.deepEqual([preview.preview?.periodLock, preview.preview?.nonFinancial], [null, false], String(preview.error));
    assert.equal(resolvePurchaseReturnEditLock({ initial: null, initialAsksReason: false, preview: preview.preview ?? null, server: null })
      .asksReason, false);
    assert.deepEqual(await updatePurchaseReturn("pr1", remark), { success: true }, String(criticalReports[0] ?? ""));
    assert.deepEqual([stockWrites, saleFacts, alerts], [[], [], []], "nothing reposted or restated, no override used");

    // In a locked return month the same edit takes the note-only path: the preview says so and asks nothing.
    declared = { "2026-08": "PD2026080001" };
    const locked = await previewPurchaseReturnUpdate("pr1", remark);
    assert.ok(locked.preview?.periodLock?.message.includes("PD2026080001"), String(locked.error));
    assert.equal(locked.preview?.nonFinancial, true);
    const state = resolvePurchaseReturnEditLock({ initial: null, initialAsksReason: false, preview: locked.preview ?? null, server: null });
    assert.deepEqual([state.asksReason, state.blocks], [false, false]);
    assert.equal(renderEditLockSection(state.lock, state.asksReason).includes(`name="${PERIOD_LOCK_REASON_FIELD}"`), false);
  });

test("Y2 save: the server refuses the same later-sale month without a reason and returns the months; the form then asks for it",
  { skip: moduleMocksUnavailable }, async () => {
    laterSaleDate = day("2026-10-02");
    declared = { "2026-10": "PD2026100001" };
    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    const { updatePurchaseReturn } = await import("../actions");
    const refused = await updatePurchaseReturn("pr1", editForm({}, discountLine(10)));
    assert.ok(refused.error?.includes("PD2026100001"), refused.error);
    assert.deepEqual([refused.periodLock?.canOverride, refused.periodLock?.periodLabels.length], [true, 1]);
    assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), [], "refused before any write");

    // Page lock (return and posting month) was open, so nothing was asked before the save; the rejection switches it on.
    const state = resolvePurchaseReturnEditLock({ initial: null, initialAsksReason: false, preview: null, server: refused.periodLock ?? null });
    assert.deepEqual([state.asksReason, state.blocks], [true, false]);
    assert.ok(renderEditLockSection(state.lock, state.asksReason).includes(`name="${PERIOD_LOCK_REASON_FIELD}"`));
    assert.equal(needsPurchaseReturnEditPreview({ financialEdited: true, hasServerLock: true, reasonGiven: false }), false,
      "after a rejection the next save goes straight to the server with the reason");

    const reason = "ผู้ขายแก้ส่วนลดตามใบลดหนี้ใหม่";
    assert.deepEqual(await updatePurchaseReturn("pr1", editForm({ [PERIOD_LOCK_REASON_FIELD]: reason }, discountLine(10))), { success: true });
    assert.equal((audits[0]?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, reason);
    assert.equal(alerts.length, 1);
  });
