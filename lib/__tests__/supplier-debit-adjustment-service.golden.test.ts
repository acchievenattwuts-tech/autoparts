import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { getThailandDateKey, getThailandMonthKey, parseDateOnlyToDate } from "@/lib/th-date";

/**
 * "ปรับยอด DN" service goldens (R5-D, T1, ก3) on an isolated in-memory transaction: parent DN 500 on 10 units of one
 * SKU with 4 on hand, so current coverage is 40%. Nothing here touches a database.
 */

type Dn = { id: string; debitNo: string; status: string; adjustsDebitNoteId: string | null; purchaseId: string; supplierId: string;
  supplierReferenceNo: string; netAmount: number; amountRemain: number; postingDate: Date; createdAt: Date;
  excessSettlementType: string | null; refundMethod: string | null; cashBankAccountId: string | null; updatedAt: Date;
  [field: string]: unknown };
type Item = { id: string; debitNoteId: string; purchaseItemId: string | null; productId: string; netAmount: number;
  inventoryAmount: number; varianceAmount: number; [field: string]: unknown };
type Payment = { debitNoteId: string; paidAmount: number; paymentId: string; paymentNo: string };
type DocPayment = { id: string; docType: string; docId: string; amount: number; cashBankAccountId: string; direction: string; createdAt: Date };
type StockRow = { id: string; productId: string; docNo: string; valueAdjustment: number; costVariance: number; detail: string };
type Store = { dns: Dn[]; items: Item[]; payments: Payment[]; docPayments: DocPayment[]; stockRows: StockRow[];
  onHand: number; audits: Array<{ action: string; after?: unknown }>; notified: Array<{ event: string; adjustment?: unknown }>;
  facts: string[]; deactivated: string[]; cashPosts: Array<{ sourceType: string; sourceId: string; entries: unknown[] }>;
  cashClears: Array<{ sourceType: string; sourceId: string }>; recalculated: string[]; declaredMonth: string | null;
  periodKeys: string[][]; docNo: number; clock: number };

const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const TODAY = getThailandDateKey();
const today = parseDateOnlyToDate(TODAY);
const PARENT_POSTING = parseDateOnlyToDate("2026-08-15");
const purchaseItem = { id: "source-line", productId: "sku", quantity: 10, showQty: null, unitScale: 1, showUnitName: "ชิ้น",
  showPricePerUnit: 100, costPrice: 100, product: { code: "SKU", name: "Brake pad" } };
const parent = (overrides: Partial<Dn> = {}): Dn => ({ id: "dn", debitNo: "SDN26080001", status: "ACTIVE", adjustsDebitNoteId: null,
  purchaseId: "purchase", supplierId: "supplier", supplierReferenceNo: "SUP-DN-1", netAmount: 500, amountRemain: 500,
  vatType: "NO_VAT", vatRate: 0, vatRecoverable: false, postingDate: PARENT_POSTING, createdAt: new Date("2026-08-15T03:00:00Z"), excessSettlementType: null, refundMethod: null,
  cashBankAccountId: null, updatedAt: new Date("2026-08-15T03:00:00Z"), ...overrides });
const initial = (): Store => ({ dns: [parent()], items: [{ id: "dn-line-1", debitNoteId: "dn", purchaseItemId: "source-line",
  productId: "sku", netAmount: 500, inventoryAmount: 200, varianceAmount: 300 }], payments: [], docPayments: [], stockRows: [],
  onHand: 4, audits: [], notified: [], facts: [], deactivated: [], cashPosts: [], cashClears: [], recalculated: [],
  declaredMonth: null, periodKeys: [], docNo: 1, clock: 0 });
let store = initial();

type Where = Record<string, unknown>;
const cmp = (value: number, rule: unknown): boolean => {
  if (rule === undefined) return true;
  if (typeof rule === "number") return value === rule;
  const r = rule as { lt?: number; gt?: number; not?: number };
  return (r.lt === undefined || value < r.lt) && (r.gt === undefined || value > r.gt) && (r.not === undefined || value !== r.not);
};
const matches = (row: Dn, where: Where | undefined): boolean => {
  if (!where) return true;
  const id = where.id as { in?: string[] } | string | undefined;
  const adjusts = where.adjustsDebitNoteId as string | { not: null } | undefined;
  return (where.status === undefined || row.status === where.status) &&
    (where.supplierId === undefined || row.supplierId === where.supplierId) &&
    (id === undefined || (typeof id === "string" ? row.id === id : !id.in || id.in.includes(row.id))) &&
    (adjusts === undefined || (typeof adjusts === "string" ? row.adjustsDebitNoteId === adjusts : row.adjustsDebitNoteId !== null)) &&
    cmp(row.netAmount, where.netAmount) && cmp(row.amountRemain, where.amountRemain);
};
const activePayments = (id: string) => store.payments.filter((row) => row.debitNoteId === id);
type RelationArgs = { select?: Record<string, unknown>; include?: Record<string, unknown> };
const relationWhere = (args: RelationArgs, key: string): Where | undefined => {
  const spec = (args.select?.[key] ?? args.include?.[key]) as { where?: Where } | undefined;
  return spec?.where;
};
const view = (row: Dn, args: RelationArgs = {}): Record<string, unknown> => {
  const parentRow = row.adjustsDebitNoteId ? store.dns.find((item) => item.id === row.adjustsDebitNoteId) : undefined;
  const childWhere = relationWhere(args, "adjustments");
  return { ...row, netAmount: D(row.netAmount), amountRemain: D(row.amountRemain), vatRate: D(Number(row.vatRate ?? 0)),
    items: store.items.filter((item) => item.debitNoteId === row.id).map((item) => ({ ...item, netAmount: D(item.netAmount) })),
    supplierPaymentItems: activePayments(row.id).map((payment) => ({ paidAmount: D(payment.paidAmount) })),
    adjustsDebitNote: parentRow ? { id: parentRow.id, debitNo: parentRow.debitNo } : null,
    adjustments: store.dns.filter((child) => child.adjustsDebitNoteId === row.id && matches(child, childWhere))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((child) => view(child)) };
};
const find = (id: string): Dn | undefined => store.dns.find((row) => row.id === id);
const toNumber = (value: unknown): unknown => (value instanceof Prisma.Decimal ? value.toNumber() : value);

const tx = {
  $queryRaw: async () => [],
  $executeRaw: async () => 0,
  purchase: { findUnique: async () => ({ id: "purchase", supplierId: "supplier", status: "ACTIVE",
    purchaseDate: parseDateOnlyToDate("2026-08-01"), items: [purchaseItem] }) },
  product: { findMany: async () => [{ id: "sku", inventoryTracking: "TRACKED" }] },
  stockCard: {
    findFirst: async (args: { where: { docDate?: { gt?: Date } } }) => (args.where.docDate?.gt ? null : { qtyBalance: store.onHand, priceBalance: 100 }),
    findUniqueOrThrow: async () => ({ priceBalance: 90 }),
    deleteMany: async ({ where }: { where: { docNo: string } }) => {
      store.stockRows = store.stockRows.filter((row) => row.docNo !== where.docNo); return { count: 1 };
    },
  },
  supplierDebitNote: {
    findUnique: async (args: RelationArgs & { where: { id: string } }) => { const row = find(args.where.id); return row ? view(row, args) : null; },
    findUniqueOrThrow: async (args: RelationArgs & { where: { id: string } }) => {
      const row = find(args.where.id); if (!row) throw new Error("not found"); return view(row, args);
    },
    findMany: async (args: { where?: Where }) => store.dns.filter((row) => matches(row, args.where)).map((row) => view(row)),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `adj-${store.dns.length}`;
      const row = { ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toNumber(value)])), id, status: "ACTIVE",
        createdAt: new Date(Date.parse("2026-09-30T03:00:00Z") + ++store.clock), updatedAt: new Date() } as Dn;
      store.dns.push(row); return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = find(where.id); assert.ok(row);
      Object.assign(row, Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toNumber(value)]))); return row;
    },
  },
  supplierDebitNoteItem: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const item = { ...data, id: `line-${store.items.length + 1}` } as Item; store.items.push(item); return item;
    },
    update: async () => ({}),
  },
  supplierPaymentItem: { findMany: async ({ where }: { where: { debitNoteId: string } }) =>
    activePayments(where.debitNoteId).map((payment) => ({ payment: { id: payment.paymentId, paymentNo: payment.paymentNo } })) },
  cashBankAccount: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "acc-bank" ? { type: "BANK" } : null) },
  documentPayment: {
    deleteMany: async ({ where }: { where: { docType: string; docId: string } }) => {
      store.docPayments = store.docPayments.filter((row) => !(row.docType === where.docType && row.docId === where.docId)); return { count: 1 };
    },
    createMany: async ({ data }: { data: Array<Omit<DocPayment, "id" | "createdAt">> }) => {
      for (const row of data) store.docPayments.push({ ...row, amount: Number(row.amount), id: `dp-${store.docPayments.length + 1}`, createdAt: new Date() });
      return { count: data.length };
    },
    findMany: async ({ where }: { where: { docType: string; docId: { in: string[] } } }) =>
      store.docPayments.filter((row) => row.docType === where.docType && where.docId.in.includes(row.docId))
        .map((row) => ({ docId: row.docId, amount: D(row.amount) })),
  },
  factProfit: { updateMany: async ({ where }: { where: { sourceId: string } }) => { store.deactivated.push(where.sourceId); return { count: 1 }; } },
  profitDistribution: { findMany: async ({ where }: { where: { activePeriodKey: { in: string[] } } }) => {
    store.periodKeys.push(where.activePeriodKey.in);
    return where.activePeriodKey.in.filter((key) => key === store.declaredMonth).map((key) => ({ activePeriodKey: key, distributionNo: "PD26090001" }));
  } },
};

let adjustment: typeof import("@/lib/supplier-debit-adjustment");
let service: typeof import("@/lib/supplier-debit-note");
let guard: typeof import("@/lib/document-mutation-guard");
before(async () => {
  await mock.module("@/lib/db", { namedExports: { dbTx: async (callback: (client: typeof tx) => Promise<unknown>) => {
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; }
  } } });
  await mock.module("@/lib/doc-number", { namedExports: { generateSupplierDebitNo: async () => `SDN2609${String(++store.docNo).padStart(4, "0")}` } });
  await mock.module("@/lib/stock-card", { namedExports: {
    getStockValuationEpoch: async () => 0,
    writeStockCard: async (_client: unknown, input: { productId: string; docNo: string; qtyIn: number; qtyOut: number;
      valueAdjustment: number; costVariance: number; detail: string }) => {
      assert.equal(input.qtyIn, 0); assert.equal(input.qtyOut, 0);
      const id = `card-${store.stockRows.length + 1}`;
      store.stockRows.push({ id, productId: input.productId, docNo: input.docNo, valueAdjustment: input.valueAdjustment,
        costVariance: input.costVariance, detail: input.detail });
      return id;
    },
    recalculateStockCardMany: async (_client: unknown, productIds: Iterable<string>) => { store.recalculated.push(...productIds); },
  } });
  await mock.module("@/lib/profit-fact", { namedExports: { rebuildSupplierDebitProfitFacts: async (_client: unknown, id: string) => { store.facts.push(id); } } });
  await mock.module("@/lib/audit-log", { namedExports: { writeAuditLogTx: async (_client: unknown, entry: { action: string; after?: unknown }) => {
    store.audits.push({ action: entry.action, after: entry.after });
  } } });
  await mock.module("@/lib/notifications", { namedExports: {
    notifySupplierDebitNote: async (debit: { adjustment?: unknown }, event: string) => { store.notified.push({ event, adjustment: debit.adjustment }); },
    safeNotifyPeriodLockOverride: async () => undefined,
  } });
  await mock.module("@/lib/sale-cost-restatement", { namedExports: {
    planSaleCostRestatement: async () => ({ saleItems: [], returnRows: [], residualRows: [], creditNotes: [], unlinkedSaleRows: 0 }),
    restatementDates: () => [],
    summarizeSaleCostRestatement: () => ({ saleCount: 0, saleNos: [], saleNosTruncated: false, lineCount: 0, costBefore: 0, costAfter: 0,
      delta: 0, creditNoteCount: 0, creditNoteNos: [], returnRowCount: 0, residualRowCount: 0, unlinkedSaleRows: 0 }),
    applyRestatedReturnCosts: async () => undefined,
    applyRestatedSaleCosts: async () => undefined,
  } });
  await mock.module("@/lib/profit-cache", { namedExports: { revalidateProfitDashboardCache: () => undefined } });
  await mock.module("@/lib/cash-bank", { namedExports: {
    replaceCashBankSourceMovements: async (_client: unknown, sourceType: string, sourceId: string, entries: unknown[]) => {
      store.cashPosts.push({ sourceType, sourceId, entries });
    },
    clearCashBankSourceMovements: async (_client: unknown, sourceType: string, sourceId: string) => { store.cashClears.push({ sourceType, sourceId }); },
  } });
  adjustment = await import("@/lib/supplier-debit-adjustment");
  service = await import("@/lib/supplier-debit-note");
  guard = await import("@/lib/document-mutation-guard");
});
beforeEach(() => { store = initial(); });

const actor = { userId: "actor", userName: "Owner" };
const reduce = (overrides: Record<string, unknown> = {}) => ({ parentId: "dn", supplierReferenceNo: "SUP-CN-1", debitDate: TODAY,
  receivedDate: TODAY, dueDate: TODAY, reason: "ซัพพลายเออร์ลดราคา", note: "", vatType: "NO_VAT", vatRate: 0,
  items: [{ purchaseItemId: "source-line", affectedQuantity: 10, amountMode: "TOTAL", increaseAmount: -200 }],
  expectedInventoryAmount: -80, expectedVarianceAmount: -120, ...overrides });
const increase = () => reduce({ supplierReferenceNo: "SUP-DN-2", items: [{ purchaseItemId: "source-line", affectedQuantity: 10,
  amountMode: "TOTAL", increaseAmount: 100 }], expectedInventoryAmount: 40, expectedVarianceAmount: 60 });
const payParent = (): void => {
  store.payments.push({ debitNoteId: "dn", paidAmount: 500, paymentId: "pay-1", paymentNo: "SP26090001" });
  find("dn")!.amountRemain = 0;
};
const created = (): Dn => store.dns.find((row) => row.adjustsDebitNoteId === "dn")!;

describe("ปรับยอด DN: create", () => {
  it("parent 500 unpaid, adjustment -200: parent outstanding 300; inventory -80 / variance -120 by today's 40% coverage", async () => {
    const result = await adjustment.postSupplierDebitAdjustment(reduce(), actor);
    const adj = created();
    assert.equal(result.id, adj.id);
    assert.deepEqual([adj.netAmount, adj.inventoryAmount, adj.varianceAmount, adj.amountRemain], [-200, -80, -120, 0]);
    assert.equal(find("dn")!.amountRemain, 300);
    assert.equal(find("dn")!.netAmount, 500, "the parent never changes except its outstanding balance");
    assert.equal(adj.postingDate.getTime(), today.getTime());
    assert.equal(adj.excessSettlementType, null);
    assert.deepEqual(store.stockRows.map((row) => [row.docNo, row.valueAdjustment, row.costVariance]), [[result.debitNo, -80, -120]]);
    assert.match(store.stockRows[0].detail, /ปรับยอดจาก DN SDN26080001/);
    assert.deepEqual(store.facts, [adj.id]);
    assert.deepEqual(store.audits.map((entry) => entry.action), ["CREATE"]);
    assert.deepEqual(store.notified, [{ event: "created", adjustment: { parentDebitNo: "SDN26080001", netAmount: -200 } }]);
  });

  it("a locked month on the parent does not block the adjustment: only today's month is checked", async () => {
    store.declaredMonth = getThailandMonthKey(PARENT_POSTING);
    await adjustment.postSupplierDebitAdjustment(reduce(), actor);
    assert.deepEqual(store.periodKeys, [[getThailandMonthKey(today)]]);
    assert.equal(find("dn")!.amountRemain, 300);
  });

  it("today's month distributed blocks the adjustment without the owner override", async () => {
    store.declaredMonth = getThailandMonthKey(today);
    await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce(), actor), /ประกาศปันผลแล้ว/);
    assert.equal(store.dns.length, 1);
  });

  it("paid parent: the excess needs a settlement choice, and the preview reports it", async () => {
    payParent();
    const preview = await adjustment.previewSupplierDebitAdjustment(reduce());
    assert.deepEqual([preview.direction, preview.parentRemain, preview.appliedToParent, preview.excessAmount], ["DECREASE", 0, 0, 200]);
    await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce({ expectedExcessAmount: 200 }), actor), /เลือกว่าจะเก็บเป็นเครดิต/);
    assert.equal(store.dns.length, 1);
    assert.equal(store.stockRows.length, 0);
  });

  it("paid parent, -200 kept as SUPPLIER_CREDIT: credit 200 (amountRemain -200), parent stays 0", async () => {
    payParent();
    await adjustment.postSupplierDebitAdjustment(reduce({ expectedExcessAmount: 200, excessSettlementType: "SUPPLIER_CREDIT" }), actor);
    const adj = created();
    assert.deepEqual([adj.excessSettlementType, adj.amountRemain, find("dn")!.amountRemain], ["SUPPLIER_CREDIT", -200, 0]);
    assert.equal(store.cashPosts.length, 0);
  });

  it("paid parent, -200 CASH_REFUND into a bank account: DocumentPayment + cash/bank IN 200, nothing left open", async () => {
    payParent();
    const result = await adjustment.postSupplierDebitAdjustment(reduce({ expectedExcessAmount: 200, excessSettlementType: "CASH_REFUND",
      cashBankAccountId: "acc-bank" }), actor);
    const adj = created();
    assert.deepEqual([adj.excessSettlementType, adj.refundMethod, adj.cashBankAccountId, adj.amountRemain], ["CASH_REFUND", "TRANSFER", "acc-bank", 0]);
    assert.deepEqual(store.docPayments.map((row) => [row.docType, row.docId, row.amount, row.direction, row.cashBankAccountId]),
      [["SUPPLIER_DEBIT_REFUND", adj.id, 200, "IN", "acc-bank"]]);
    assert.equal(store.cashPosts.length, 1);
    assert.equal(store.cashPosts[0].sourceType, "SUPPLIER_DEBIT_REFUND");
    assert.deepEqual(store.cashPosts[0].entries, [{ accountId: "acc-bank", txnDate: today, direction: "IN", amount: 200,
      referenceNo: result.debitNo, note: "รับเงินคืน ปรับยอดจาก DN SDN26080001" }]);
  });

  it("a stale preview (the parent was paid meanwhile) asks for a new preview instead of guessing the excess", async () => {
    payParent();
    await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce({ excessSettlementType: "SUPPLIER_CREDIT" }), actor),
      /ตรวจยอดอีกครั้ง/);
    assert.equal(store.dns.length, 1);
  });

  it("+100 adjustment: its own AP of 100, posted like a DN today; the parent keeps 500", async () => {
    await adjustment.postSupplierDebitAdjustment(increase(), actor);
    const adj = created();
    assert.deepEqual([adj.netAmount, adj.amountRemain, adj.inventoryAmount, adj.varianceAmount], [100, 100, 40, 60]);
    assert.equal(find("dn")!.amountRemain, 500);
  });

  // The fixture has no SiteContent: an adjustment never reads the VAT registration setting, it inherits (V3).
  it("V3: inherits a recoverable parent's VAT: -100 excl. 7% -> AP -107, cost -100 -> stock -40 / variance -60", async () => {
    store.dns[0] = parent({ vatType: "EXCLUDING_VAT", vatRate: 7, vatRecoverable: true });
    await adjustment.postSupplierDebitAdjustment(reduce({ vatType: "EXCLUDING_VAT", vatRate: 7, expectedInventoryAmount: -40,
      expectedVarianceAmount: -60, items: [{ purchaseItemId: "source-line", affectedQuantity: 10, amountMode: "TOTAL", increaseAmount: -100 }] }), actor);
    const adj = created();
    assert.deepEqual([adj.vatType, adj.vatRate, adj.vatRecoverable], ["EXCLUDING_VAT", 7, true]);
    assert.deepEqual([adj.subtotalAmount, adj.vatAmount, adj.netAmount, adj.inventoryAmount, adj.varianceAmount], [-100, -7, -107, -40, -60]);
    assert.equal(find("dn")!.amountRemain, 393);
  });

  it("V3: inherits a non-recoverable parent's VAT even if the shop registered since: cost -107 -> stock -42.8 / variance -64.2", async () => {
    store.dns[0] = parent({ vatType: "EXCLUDING_VAT", vatRate: 7, vatRecoverable: false });
    await adjustment.postSupplierDebitAdjustment(reduce({ vatType: "EXCLUDING_VAT", vatRate: 7, expectedInventoryAmount: -42.8,
      expectedVarianceAmount: -64.2, items: [{ purchaseItemId: "source-line", affectedQuantity: 10, amountMode: "TOTAL", increaseAmount: -100 }] }), actor);
    const adj = created();
    assert.equal(adj.vatRecoverable, false);
    assert.deepEqual([adj.netAmount, adj.inventoryAmount, adj.varianceAmount], [-107, -42.8, -64.2]);
  });

  it("V3: a VAT type or rate other than the parent's is rejected before any write, in preview and save", async () => {
    for (const vat of [{ vatType: "EXCLUDING_VAT", vatRate: 7 }, { vatType: "NO_VAT", vatRate: 7 }]) {
      await assert.rejects(adjustment.previewSupplierDebitAdjustment(reduce(vat)), /VAT เดียวกับ DN ต้นทาง/);
      await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce(vat), actor), /VAT เดียวกับ DN ต้นทาง/);
    }
    assert.equal(store.dns.length, 1); assert.equal(store.stockRows.length, 0); assert.deepEqual(store.audits, []);
  });

  it("rejects mixed signs, lines not on the parent, reductions beyond what was charged, and adjusting an adjustment", async () => {
    await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce({ items: [
      { purchaseItemId: "source-line", affectedQuantity: 5, amountMode: "TOTAL", increaseAmount: -100 },
      { purchaseItemId: "source-line", affectedQuantity: 5, amountMode: "TOTAL", increaseAmount: 50 }] }), actor), /เพิ่มยอดทั้งหมดหรือลดยอดทั้งหมด/);
    await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce({ items: [
      { purchaseItemId: "other-line", affectedQuantity: 5, amountMode: "TOTAL", increaseAmount: -100 }] }), actor), /รายการของใบเพิ่มหนี้ต้นทาง/);
    await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce({ items: [
      { purchaseItemId: "source-line", affectedQuantity: 10, amountMode: "TOTAL", increaseAmount: -600 }],
    expectedInventoryAmount: -240, expectedVarianceAmount: -360 }), actor), /เกินยอดใบเพิ่มหนี้คงเหลือ/);
    await adjustment.postSupplierDebitAdjustment(reduce(), actor);
    await assert.rejects(adjustment.postSupplierDebitAdjustment(reduce({ parentId: created().id, supplierReferenceNo: "X" }), actor),
      /เฉพาะใบเพิ่มหนี้ต้นฉบับ/);
    assert.equal(store.dns.length, 2);
  });
});

describe("ปรับยอด DN: cancel and reference safety", () => {
  it("cancelling the adjustment restores the parent's outstanding balance and reverses its stock rows and facts", async () => {
    await adjustment.postSupplierDebitAdjustment(reduce(), actor);
    const adj = created();
    await service.cancelSupplierDebitNote(adj.id, "บันทึกผิด", actor);
    assert.deepEqual([adj.status, adj.amountRemain, find("dn")!.amountRemain], ["CANCELLED", 0, 500]);
    assert.equal(store.stockRows.length, 0);
    assert.deepEqual(store.recalculated, ["sku"]);
    assert.deepEqual(store.deactivated, [adj.id]);
    assert.deepEqual(store.audits.map((entry) => entry.action), ["CREATE", "CANCEL"]);
    assert.deepEqual(store.notified.at(-1), { event: "cancelled", adjustment: { parentDebitNo: "SDN26080001", netAmount: -200 } });
  });

  it("cancelling a CASH_REFUND adjustment reverses the refund movement and its DocumentPayment row", async () => {
    payParent();
    await adjustment.postSupplierDebitAdjustment(reduce({ expectedExcessAmount: 200, excessSettlementType: "CASH_REFUND",
      cashBankAccountId: "acc-bank" }), actor);
    const adj = created();
    await service.cancelSupplierDebitNote(adj.id, "ซัพพลายเออร์ยกเลิกการลดราคา", actor);
    assert.deepEqual(store.cashClears, [{ sourceType: "SUPPLIER_DEBIT_REFUND", sourceId: adj.id }]);
    assert.equal(store.docPayments.length, 0);
    assert.equal(find("dn")!.amountRemain, 0, "the parent is still fully paid");
  });

  it("an adjustment whose credit an ACTIVE payment consumed cannot be cancelled; the payment number is listed", async () => {
    payParent();
    await adjustment.postSupplierDebitAdjustment(reduce({ expectedExcessAmount: 200, excessSettlementType: "SUPPLIER_CREDIT" }), actor);
    const adj = created();
    store.payments.push({ debitNoteId: adj.id, paidAmount: 200, paymentId: "pay-2", paymentNo: "SP26090002" });
    await assert.rejects(service.cancelSupplierDebitNote(adj.id, "x", actor), /SP26090002/);
    assert.equal(adj.status, "ACTIVE");
  });

  it("the parent cannot be cancelled or reposted while an adjustment is ACTIVE; the guard links the adjustment", async () => {
    const result = await adjustment.postSupplierDebitAdjustment(reduce(), actor);
    await assert.rejects(service.cancelSupplierDebitNote("dn", "x", actor), new RegExp(result.debitNo));
    for (const action of ["cancel", "update"] as const) {
      const block = await guard.createDocumentMutationGuard(tx as unknown as import("@/lib/document-mutation-guard").GuardDb)
        .check("SupplierDebitNote", "dn", action);
      assert.equal(block.blocked, true);
      assert.equal(block.reason, guard.SUPPLIER_DEBIT_ADJUSTED_REASON);
      assert.deepEqual(guard.buildMutationBlockReferenceLinks(block), [{ href: `/admin/supplier-debit-notes/${created().id}`, label: result.debitNo }]);
    }
    assert.equal(find("dn")!.status, "ACTIVE");
  });

  it("an adjustment itself is never edited in place", async () => {
    await adjustment.postSupplierDebitAdjustment(reduce(), actor);
    const adj = created();
    await assert.rejects(service.updateSupplierDebitNote(adj.id, { purchaseId: "purchase", supplierReferenceNo: "SUP-CN-1",
      debitDate: TODAY, receivedDate: TODAY, dueDate: TODAY, reason: "x", note: "", vatType: "NO_VAT", vatRate: 0,
      items: [{ purchaseItemId: "source-line", affectedQuantity: 10, amountMode: "TOTAL", increaseAmount: 1 }],
      expectedUpdatedAt: new Date().toISOString() }, actor), new RegExp(service.SUPPLIER_DEBIT_ADJUSTMENT_EDIT_MESSAGE.slice(0, 20)));
  });
});
