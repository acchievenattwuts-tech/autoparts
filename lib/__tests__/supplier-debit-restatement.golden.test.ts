import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { addThailandDays, getThailandDateKey, getThailandMonthKey, parseDateOnlyToDate } from "@/lib/th-date";

// T1 option A end to end: the real DN service, restatement planner, MAVG engine and profit facts run
// against an in-memory transaction. Only audit, notifications, numbering and cache calls are mocked.

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
const D = (value: number) => new Prisma.Decimal(value);
const TODAY = parseDateOnlyToDate(getThailandDateKey());
const day = (offset: number): Date => addThailandDays(TODAY, offset);
const RECEIPT_DAY = day(-3);
const DEBIT_DAY = day(-2);
const SALE_DAY = day(-1);

type Store = {
  products: Row[]; cards: Row[]; purchases: Row[]; purchaseItems: Row[]; debits: Row[]; debitItems: Row[]; payments: Row[];
  sales: Row[]; saleItems: Row[]; saleItemLots: Row[]; creditNotes: Row[]; creditNoteItems: Row[]; facts: Row[]; distributions: Row[];
};
let store: Store;
let audits: Array<{ action: string; after?: Row; meta?: Row }> = [];
let notices: Array<{ event: string; restatement?: { saleCount: number; delta: number } }> = [];
let overrides: Array<{ action: string; reason: string; periodLabels: string[] }> = [];
let clock = 0;

const cloneStore = (source: Store): Store => Object.fromEntries(Object.entries(source)
  .map(([key, rows]) => [key, (rows as Row[]).map((row) => ({ ...row }))])) as Store;
const plain = (value: unknown): unknown => (value instanceof Prisma.Decimal ? value.toNumber() : value instanceof Date ? value.getTime() : value);
const matchValue = (value: unknown, condition: unknown): boolean => {
  if (condition && typeof condition === "object" && !(condition instanceof Date) && !(condition instanceof Prisma.Decimal)) {
    const c = condition as Record<string, unknown>;
    const v = plain(value);
    if ("in" in c && !(c.in as unknown[]).map(plain).includes(v)) return false;
    if ("notIn" in c && (c.notIn as unknown[]).map(plain).includes(v)) return false;
    if ("not" in c && plain(c.not) === v) return false;
    if ("gt" in c && !((v as number) > (plain(c.gt) as number))) return false;
    if ("gte" in c && !((v as number) >= (plain(c.gte) as number))) return false;
    if ("lt" in c && !((v as number) < (plain(c.lt) as number))) return false;
    if ("lte" in c && !((v as number) <= (plain(c.lte) as number))) return false;
    return true;
  }
  return plain(value) === plain(condition);
};
const matches = (record: Row, where: Where = {}): boolean => Object.entries(where).every(([key, condition]) =>
  key === "OR" ? (condition as Where[]).some((part) => matches(record, part)) : matchValue(record[key], condition));
const sortBy = (rows: Row[], orderBy: unknown): Row[] => {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((entry) => Object.entries(entry as Row));
  return [...rows].sort((a, b) => {
    for (const [key, direction] of keys) {
      const diff = (plain(a[key]) as number) > (plain(b[key]) as number) ? 1 : (plain(a[key]) as number) < (plain(b[key]) as number) ? -1 : 0;
      if (diff !== 0) return direction === "desc" ? -diff : diff;
    }
    return 0;
  });
};
const sqlValues = (values: unknown[]): unknown[] => values.flatMap((value) =>
  typeof value === "object" && value !== null && "values" in value && "strings" in value ? (value as { values: unknown[] }).values : [value]);
const col = (value: unknown, scale: number) => new Prisma.Decimal(String(value)).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
const byId = (rows: Row[], id: unknown): Row => {
  const found = rows.find((row) => row.id === id);
  assert.ok(found, `missing ${String(id)}`);
  return found;
};

function applyExecuteRaw(text: string, flat: unknown[]): void {
  if (text.includes("pg_advisory_xact_lock")) return;
  const each = (size: number, apply: (values: unknown[]) => void): void => {
    for (let i = 0; i < flat.length; i += size) apply(flat.slice(i, i + size));
  };
  if (text.includes('"qtyBalance" = data."qtyBalance"')) {
    each(5, ([id, priceOut, qtyBalance, priceBalance, costVariance]) => Object.assign(byId(store.cards, id), {
      priceOut: col(priceOut, 4), qtyBalance: col(qtyBalance, 4), priceBalance: col(priceBalance, 4),
      ...(costVariance === null ? {} : { costVariance: col(costVariance, 2) }) }));
  } else if (text.includes('SET "sorder" = data."sorder"')) {
    each(2, ([id, sorder]) => { byId(store.cards, id).sorder = Number(sorder); });
  } else if (text.includes('UPDATE "Product"')) {
    each(3, ([id, stock, avgCost]) => Object.assign(byId(store.products, id), { stock: Number(stock), avgCost: col(avgCost, 2) }));
  } else if (text.includes('"priceIn" = data."priceIn"')) {
    each(2, ([id, priceIn]) => { byId(store.cards, id).priceIn = col(priceIn, 4); });
  } else if (text.includes('UPDATE "SaleItem" AS si')) {
    each(2, ([id, costPrice]) => { byId(store.saleItems, id).costPrice = col(costPrice, 2); });
  } else if (text.includes('UPDATE "SaleItemLot"')) {
    each(2, ([saleItemId, delta]) => store.saleItemLots.filter((lot) => lot.saleItemId === saleItemId)
      .forEach((lot) => { lot.unitCost = Prisma.Decimal.max(0, (lot.unitCost as Prisma.Decimal).plus(Number(delta))); }));
  } else assert.fail(`unexpected $executeRaw: ${text}`);
}

const productOf = (id: unknown): Row => byId(store.products, id);
const debitView = (debit: Row): Row => ({
  ...debit, supplier: { name: "ซัพพลายเออร์ทดสอบ" }, purchase: { purchaseNo: "PO-1" },
  items: sortBy(store.debitItems.filter((item) => item.debitNoteId === debit.id), { lineNo: "asc" })
    .map((item) => ({ ...item, product: productOf(item.productId) })),
  supplierPaymentItems: store.payments.filter((payment) => payment.debitNoteId === debit.id && payment.status === "ACTIVE"),
});
const saleView = (sale: Row): Row => ({ ...sale, customer: null,
  items: sortBy(store.saleItems.filter((item) => item.saleId === sale.id), { lineNo: "asc" }).map((item) => ({ ...item, product: productOf(item.productId) })) });
const creditItemView = (item: Row): Row => {
  const note = byId(store.creditNotes, item.creditNoteId);
  return { ...item, creditNote: note, product: item.productId ? productOf(item.productId) : null };
};
const tick = (): Date => new Date(Date.UTC(2026, 8, 30, 3, 0, ++clock));

const tx = {
  $queryRaw: async () => [],
  $executeRaw: async (strings: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
    if ("strings" in strings && !Array.isArray(strings)) { applyExecuteRaw(strings.strings.join("?"), strings.values); return 0; }
    applyExecuteRaw((strings as TemplateStringsArray).join("?"), sqlValues(values));
    return 0;
  },
  stockCard: {
    findMany: async ({ where, orderBy }: { where: Where; orderBy?: unknown }) =>
      sortBy(store.cards.filter((row) => matches(row, where)), orderBy ?? [{ docDate: "asc" }, { sorder: "asc" }]).map((row) => ({ ...row })),
    findFirst: async ({ where, orderBy }: { where: Where; orderBy?: unknown }) => {
      const [first] = sortBy(store.cards.filter((row) => matches(row, where)), orderBy);
      return first ? { ...first } : null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...byId(store.cards, where.id) }),
    create: async ({ data }: { data: Row }) => {
      const created = { ...data, id: `card-${store.cards.length + 1}`, referenceId: data.referenceId ?? null,
        valueAdjustment: D(Number(data.valueAdjustment ?? 0)), costVariance: D(Number(data.costVariance ?? 0)) };
      store.cards.push(created);
      return { id: created.id };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(byId(store.cards, where.id), data),
    deleteMany: async ({ where }: { where: Where }) => {
      const before = store.cards.length;
      store.cards = store.cards.filter((row) => !matches(row, where));
      return { count: before - store.cards.length };
    },
  },
  product: {
    findUnique: async ({ where }: { where: { id: string } }) => ({ ...productOf(where.id) }),
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => store.products.filter((row) => where.id.in.includes(row.id as string)),
    update: async ({ where, data }: { where: { id: string }; data: Row }) =>
      Object.assign(productOf(where.id), { stock: data.stock, avgCost: col(data.avgCost, 2) }),
  },
  purchase: { findUnique: async () => ({ ...store.purchases[0],
    items: store.purchaseItems.map((item) => ({ ...item, product: productOf(item.productId) })) }) },
  purchaseItem: { findMany: async ({ where }: { where: Where }) => store.purchaseItems.filter((item) => matches(item, where)) },
  supplierDebitNote: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const debit = store.debits.find((row) => row.id === where.id);
      return debit ? debitView(debit) : null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => debitView(byId(store.debits, where.id)),
    findMany: async () => [],
    // Prisma returns Decimal for money columns whatever the write passed.
    update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(byId(store.debits, where.id),
      Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === "number" ? D(value) : value])), { updatedAt: tick() }),
  },
  supplierDebitNoteItem: {
    create: async ({ data }: { data: Row }) => { const item = { ...data, id: `dni-${store.debitItems.length + 10}` }; store.debitItems.push(item); return item; },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(byId(store.debitItems, where.id), data),
    deleteMany: async ({ where }: { where: { debitNoteId: string } }) => {
      store.debitItems = store.debitItems.filter((item) => item.debitNoteId !== where.debitNoteId); return { count: 1 };
    },
  },
  supplierPaymentItem: { findMany: async ({ where }: { where: { debitNoteId: string } }) => store.payments
    .filter((payment) => payment.debitNoteId === where.debitNoteId && payment.status === "ACTIVE")
    .map((payment) => ({ payment: { id: payment.paymentId, paymentNo: payment.paymentNo } })) },
  sale: { findUnique: async ({ where }: { where: { id: string } }) => saleView(byId(store.sales, where.id)) },
  saleItem: { findMany: async ({ where }: { where: Where }) => store.saleItems.filter((item) => matches(item, where))
    .map((item) => ({ ...item, sale: byId(store.sales, item.saleId) })) },
  creditNote: { findUnique: async ({ where }: { where: { id: string } }) => {
    const note = byId(store.creditNotes, where.id);
    return { ...note, customer: null, sale: note.saleId ? saleView(byId(store.sales, note.saleId)) : null,
      items: sortBy(store.creditNoteItems.filter((item) => item.creditNoteId === note.id), { lineNo: "asc" }).map(creditItemView) };
  } },
  creditNoteItem: { findMany: async ({ where }: { where: Where & { creditNote?: Where } }) => {
    const { creditNote, ...own } = where;
    return store.creditNoteItems.filter((item) => matches(item, own) && (!creditNote || matches(byId(store.creditNotes, item.creditNoteId), creditNote)))
      .map(creditItemView);
  } },
  factProfit: {
    findMany: async ({ where }: { where: Where }) => store.facts.filter((fact) => matches(fact, where)),
    updateMany: async ({ where, data }: { where: Where; data: Row }) => {
      const hit = store.facts.filter((fact) => matches(fact, where));
      hit.forEach((fact) => Object.assign(fact, data));
      return { count: hit.length };
    },
    aggregate: async ({ where }: { where: Where }) => ({ _max: { versionNo: Math.max(0, ...store.facts
      .filter((fact) => matches(fact, where)).map((fact) => Number(fact.versionNo))) || null } }),
    create: async ({ data }: { data: Row }) => { store.facts.push({ ...data, id: `fact-${store.facts.length + 1}` }); return {}; },
  },
  profitDistribution: { findMany: async ({ where }: { where: { activePeriodKey: { in: string[] } } }) => store.distributions
    .filter((row) => where.activePeriodKey.in.includes(row.activePeriodKey as string) && row.status === "ACTIVE") },
};

let service: typeof import("@/lib/supplier-debit-note");
before(async () => {
  await mock.module("@/lib/db", { namedExports: { db: tx, dbTx: async (callback: (client: typeof tx) => Promise<unknown>) => {
    const snapshot = cloneStore(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; }
  } } });
  await mock.module("@/lib/doc-number", { namedExports: { generateSupplierDebitNo: async () => "SDN-NEW" } });
  await mock.module("@/lib/audit-log", { namedExports: { writeAuditLogTx: async (_client: unknown, entry: { action: string; after?: Row; meta?: Row }) => {
    audits.push({ action: entry.action, after: entry.after, meta: entry.meta });
  } } });
  await mock.module("@/lib/notifications", { namedExports: {
    notifySupplierDebitNote: async (debit: { restatement?: { saleCount: number; delta: number } }, event: string) => {
      notices.push({ event, ...(debit.restatement ? { restatement: debit.restatement } : {}) });
    },
    safeNotifyPeriodLockOverride: async (input: { action: string; reason: string; periodLabels: string[] }) => {
      overrides.push({ action: input.action, reason: input.reason, periodLabels: input.periodLabels });
    },
  } });
  await mock.module("@/lib/profit-cache", { namedExports: { revalidateProfitDashboardCache: () => undefined } });
  await mock.module("@/lib/storefront-sync-queue", { namedExports: {
    enqueueStorefrontStockInvalidation: async () => undefined, enqueueStorefrontStockInvalidations: async () => undefined,
  } });
  service = await import("@/lib/supplier-debit-note");
});

const card = (id: string, date: Date, sorder: number, source: string, qtyIn: number, qtyOut: number, balances: [number, number, number],
  extra: Row = {}): Row => ({ id, productId: "sku", docNo: `DOC-${id}`, docDate: date, sorder, source, referenceId: null,
  qtyIn: D(qtyIn), qtyOut: D(qtyOut), priceIn: D(0), landedCost: D(0), usesReferenceCost: false, valueAdjustment: D(0),
  costVariance: D(0), valuationEpoch: 0, qtyBalance: D(balances[0]), priceBalance: D(balances[1]), priceOut: D(balances[2]), ...extra });
const sale = (id: string, saleNo: string, date: Date, amount: number): Row => ({ id, saleNo, saleDate: date, status: "ACTIVE", channel: null,
  customerId: null, customerName: "ลูกค้าทั่วไป", subtotalAmount: D(amount), vatAmount: D(0), netAmount: D(amount), discount: D(0),
  shippingFee: D(0), vatRate: D(0), vatType: "NO_VAT" });
const saleLine = (id: string, saleId: string, quantity: number, costPrice: number, total: number): Row => ({ id, saleId, lineNo: 1, productId: "sku",
  quantity: D(quantity), salePrice: D(total / quantity), costPrice: D(costPrice), totalAmount: D(total), supplierId: null, supplierName: null });
const saleFact = (saleId: string, saleNo: string, date: Date, sales: number, cost: number): Row => ({ id: `fact-${saleId}`,
  sourceType: "SALE", sourceId: saleId, sourceLineId: `line-${saleId}`, sourceDocNo: saleNo, businessDate: date, isActive: true, versionNo: 1,
  salesAmountExVat: D(sales), costAmount: D(cost), grossProfit: D(sales - cost), netProfitAmount: D(sales - cost) });

/** Receive 10 @ 100, sell 6, DN +50/unit x 10 posted with 4 on hand (+200 -> 4 @ 150), then sell 2 at 150. */
function seed(options: { withLaterSale?: boolean; paid?: number } = {}): void {
  const laterSale = options.withLaterSale ?? true;
  store = {
    products: [{ id: "sku", code: "SKU-1", name: "ผ้าเบรก", inventoryTracking: "TRACKED", stock: laterSale ? 2 : 4, avgCost: D(150) }],
    cards: [
      card("receipt", RECEIPT_DAY, 1, "PURCHASE", 10, 0, [10, 100, 0], { priceIn: D(100) }),
      card("sale-1", RECEIPT_DAY, 2, "SALE", 0, 6, [4, 100, 100], { referenceId: "si-1" }),
      card("dn-row", DEBIT_DAY, 3, "SUPPLIER_DEBIT", 0, 0, [4, 150, 100], { docNo: "SDN1", valuationEpoch: 1, valueAdjustment: D(200),
        costVariance: D(300), referenceId: "dni-1" }),
      ...(laterSale ? [card("sale-2", SALE_DAY, 4, "SALE", 0, 2, [2, 150, 150], { referenceId: "si-2" })] : []),
    ],
    purchases: [{ id: "po", purchaseNo: "PO-1", supplierId: "sup", status: "ACTIVE", purchaseDate: RECEIPT_DAY }],
    purchaseItems: [{ id: "pi", purchaseId: "po", productId: "sku", quantity: D(10), showQty: D(10), unitScale: D(1),
      showUnitName: "ชิ้น", showPricePerUnit: D(100), costPrice: D(100) }],
    debits: [{ id: "dn", debitNo: "SDN1", purchaseId: "po", supplierId: "sup", status: "ACTIVE", postingDate: DEBIT_DAY,
      debitDate: DEBIT_DAY, receivedDate: DEBIT_DAY, dueDate: DEBIT_DAY, supplierReferenceNo: "SUP-DN-1", reason: "ปรับราคา", note: "",
      vatType: "NO_VAT", vatRate: D(0), vatRecoverable: false, subtotalAmount: D(500), vatAmount: D(0), netAmount: D(500),
      inventoryAmount: D(200), varianceAmount: D(300), amountRemain: D(500 - (options.paid ?? 0)), updatedAt: tick() }],
    debitItems: [{ id: "dni-1", debitNoteId: "dn", purchaseItemId: "pi", productId: "sku", lineNo: 1, amountMode: "PER_UNIT",
      increaseAmount: D(50), affectedQuantity: D(10), affectedBaseQuantity: D(10), inventoryAmount: D(200), varianceAmount: D(300) }],
    payments: options.paid ? [{ debitNoteId: "dn", status: "ACTIVE", paidAmount: D(options.paid), paymentId: "pay-1", paymentNo: "SP-1" }] : [],
    sales: [sale("s1", "SA-1", RECEIPT_DAY, 1200), ...(laterSale ? [sale("s2", "SA-2", SALE_DAY, 400)] : [])],
    saleItems: [saleLine("si-1", "s1", 6, 100, 1200), ...(laterSale ? [saleLine("si-2", "s2", 2, 150, 400)] : [])],
    saleItemLots: laterSale ? [{ id: "lot-1", saleItemId: "si-2", unitCost: D(150) }] : [],
    creditNotes: [], creditNoteItems: [],
    facts: [
      { id: "fact-dn", sourceType: "PURCHASE_COST_VARIANCE", sourceId: "dn", isActive: true, versionNo: 1, costAmount: D(300), businessDate: DEBIT_DAY },
      ...(laterSale ? [saleFact("s2", "SA-2", SALE_DAY, 400, 300)] : []),
    ],
    distributions: [],
  };
}
const actor = { userId: "owner", userName: "เจ้าของร้าน" };
const activeSaleFacts = (saleId: string) => store.facts.filter((fact) => fact.sourceType === "SALE" && fact.sourceId === saleId && fact.isActive);
const grossOf = (saleId: string): number => activeSaleFacts(saleId).reduce((sum, fact) => sum + Number(fact.grossProfit), 0);
const editInput = (increaseAmount: number, inventory: number, variance: number) => ({
  purchaseId: "po", supplierReferenceNo: "SUP-DN-1", debitDate: getThailandDateKey(DEBIT_DAY), receivedDate: getThailandDateKey(DEBIT_DAY),
  dueDate: getThailandDateKey(DEBIT_DAY), reason: "ปรับราคา", note: "", vatType: "NO_VAT", vatRate: 0,
  expectedInventoryAmount: inventory, expectedVarianceAmount: variance, expectedUpdatedAt: (store.debits[0].updatedAt as Date).toISOString(),
  items: [{ purchaseItemId: "pi", amountMode: "PER_UNIT", increaseAmount, affectedQuantity: 10 }],
});
const declare = (date: Date): void => {
  store.distributions.push({ activePeriodKey: getThailandMonthKey(date), distributionNo: "PD-1", status: "ACTIVE" });
};

beforeEach(() => { audits = []; notices = []; overrides = []; seed(); });

describe("T1: DN cancel restates later sales", () => {
  it("cancel re-costs the 2 units sold after the DN from 150 to 100, rebuilds the SALE fact: gross profit +100", async () => {
    assert.equal(grossOf("s2"), 100);
    await service.cancelSupplierDebitNote("dn", "ซัพพลายเออร์ยกเลิก DN", actor);
    assert.equal(Number(byId(store.saleItems, "si-2").costPrice), 100);
    assert.equal(Number(store.saleItemLots[0].unitCost), 100);
    assert.equal(Number(byId(store.saleItems, "si-1").costPrice), 100);
    assert.deepEqual(activeSaleFacts("s2").map((fact) => [Number(fact.costAmount), Number(fact.grossProfit), fact.versionNo]), [[200, 200, 2]]);
    assert.equal(grossOf("s2") - 100, 100);
    assert.equal(Number(byId(store.cards, "sale-2").priceOut), 100);
    assert.deepEqual([productOf("sku").stock, Number(productOf("sku").avgCost)], [2, 100]);
    assert.equal(store.debits[0].status, "CANCELLED");
    assert.equal(store.facts.find((fact) => fact.id === "fact-dn")?.isActive, false);
    const restatement = audits[0].after?.restatement as Row;
    assert.deepEqual([audits[0].action, restatement.saleCount, restatement.saleNos, restatement.costBefore, restatement.costAfter, restatement.delta],
      ["CANCEL", 1, ["SA-2"], 300, 200, -100]);
    assert.deepEqual(notices, [{ event: "cancelled", restatement: { saleCount: 1, delta: -100 } }]);
  });

  it("an ACTIVE payment still blocks the cancel, before any write", async () => {
    seed({ paid: 100 });
    await assert.rejects(service.cancelSupplierDebitNote("dn", "ยกเลิก", actor), /จ่ายชำระ/);
    assert.equal(store.debits[0].status, "ACTIVE");
    assert.equal(Number(byId(store.saleItems, "si-2").costPrice), 150);
    assert.deepEqual([audits, notices], [[], []]);
  });

  it("a DN with no later sale cancels as before: no restatement in the alert", async () => {
    seed({ withLaterSale: false });
    await service.cancelSupplierDebitNote("dn", "ยกเลิก", actor);
    assert.equal(Number(productOf("sku").avgCost), 100);
    assert.equal((audits[0].after?.restatement as Row).saleCount, 0);
    assert.deepEqual(notices, [{ event: "cancelled" }]);
  });

  it("a restated return re-costs too: the customer's return of 1 unit and a later sale follow the DN-free cost", async () => {
    store.cards.push(card("cn-row", SALE_DAY, 5, "RETURN_IN", 1, 0, [3, 150, 150], { referenceId: "cni-1", usesReferenceCost: true, priceIn: D(150) }),
      card("sale-3", SALE_DAY, 6, "SALE", 0, 1, [2, 150, 150], { referenceId: "si-3" }));
    store.creditNotes.push({ id: "cn", cnNo: "CN-1", cnDate: SALE_DAY, status: "ACTIVE", type: "RETURN", saleId: "s2", channel: null,
      totalAmount: D(200), subtotalAmount: D(200), customerId: null, customerName: "ลูกค้าทั่วไป" });
    store.creditNoteItems.push({ id: "cni-1", creditNoteId: "cn", lineNo: 1, saleItemId: "si-2", productId: "sku", qty: D(1),
      amount: D(200), unitPrice: D(200), stockDisposition: "RESTOCK" });
    store.sales.push(sale("s3", "SA-3", SALE_DAY, 200));
    store.saleItems.push(saleLine("si-3", "s3", 1, 150, 200));
    await service.cancelSupplierDebitNote("dn", "ยกเลิก", actor);
    assert.deepEqual(["si-2", "si-3"].map((id) => Number(byId(store.saleItems, id).costPrice)), [100, 100]);
    assert.equal(Number(byId(store.cards, "cn-row").priceIn), 100);
    const returnFacts = store.facts.filter((fact) => fact.sourceType === "SALE_RETURN" && fact.isActive);
    assert.deepEqual(returnFacts.map((fact) => Number(fact.costAmount)), [-100]);
    assert.deepEqual((audits[0].after?.restatement as Row).creditNoteNos, ["CN-1"]);
  });
});

describe("T1: DN edit reposts at the original date and restates later sales", () => {
  it("+30/unit at the original date and epoch: coverage 4 at that position -> avg 130, the later sale costs 130", async () => {
    await service.updateSupplierDebitNote("dn", editInput(30, 120, 180), actor);
    const debit = store.debits[0];
    assert.equal((debit.postingDate as Date).getTime(), DEBIT_DAY.getTime());
    assert.deepEqual([Number(debit.netAmount), Number(debit.amountRemain), Number(debit.inventoryAmount)], [300, 300, 120]);
    const reposted = store.cards.find((row) => row.source === "SUPPLIER_DEBIT");
    assert.deepEqual([(reposted?.docDate as Date).getTime(), reposted?.valuationEpoch, Number(reposted?.priceBalance)], [DEBIT_DAY.getTime(), 1, 130]);
    assert.deepEqual(store.debitItems.map((item) => [Number(item.stockBefore), Number(item.avgCostBefore), Number(item.avgCostAfter)]), [[4, 100, 130]]);
    assert.equal(Number(byId(store.saleItems, "si-2").costPrice), 130);
    assert.deepEqual(activeSaleFacts("s2").map((fact) => Number(fact.costAmount)), [260]);
    assert.deepEqual(notices, [{ event: "updated", restatement: { saleCount: 1, delta: -40 } }]);
    const variance = store.facts.filter((fact) => fact.sourceType === "PURCHASE_COST_VARIANCE" && fact.isActive);
    assert.deepEqual(variance.map((fact) => [Number(fact.costAmount), (fact.businessDate as Date).getTime()]), [[180, DEBIT_DAY.getTime()]]);
  });

  it("the preview agrees with the repost (position coverage) and reports the restatement", async () => {
    const preview = await service.previewSupplierDebitNote(editInput(30, 120, 180), { debitId: "dn" });
    assert.deepEqual([preview.inventoryAmount, preview.varianceAmount, preview.restatement], [120, 180, { saleCount: 1, delta: -40 }]);
    assert.deepEqual(preview.lockedPeriods, []);
  });

  it("payments: an edit keeps a 200 payment when the new net 300 covers it; a new net of 100 is rejected before any write", async () => {
    seed({ paid: 200 });
    await assert.rejects(service.updateSupplierDebitNote("dn", editInput(10, 40, 60), actor), /ต่ำกว่ายอดที่จ่ายชำระแล้ว 200\.00 บาท/);
    assert.deepEqual([Number(store.debits[0].netAmount), audits.length], [500, 0]);
    await service.updateSupplierDebitNote("dn", editInput(30, 120, 180), actor);
    assert.deepEqual([Number(store.debits[0].netAmount), Number(store.debits[0].amountRemain)], [300, 100]);
  });
});

describe("T1: month lock", () => {
  it("a distributed month of a restated sale blocks the cancel without the override, before any write", async () => {
    declare(SALE_DAY);
    await assert.rejects(service.cancelSupplierDebitNote("dn", "ยกเลิก", actor), (error: unknown) =>
      error instanceof Error && error.name === "PeriodLockedError" && /PD-1/.test(error.message));
    assert.deepEqual([store.debits[0].status, Number(byId(store.saleItems, "si-2").costPrice), audits.length, overrides.length], ["ACTIVE", 150, 0, 0]);
    // Permission without a reason is still refused.
    await assert.rejects(service.cancelSupplierDebitNote("dn", "ยกเลิก", actor, { periodLockOverride: { allowed: true, reason: " " } }));
  });

  it("the override permission with a reason passes: audit meta and the Telegram alert carry the reason", async () => {
    declare(SALE_DAY);
    const reason = "ซัพพลายเออร์ออกใบลดหนี้ยกเลิก DN ย้อนหลัง";
    await service.cancelSupplierDebitNote("dn", "ยกเลิก", actor, { periodLockOverride: { allowed: true, reason } });
    assert.equal(store.debits[0].status, "CANCELLED");
    const meta = audits[0].meta?.periodLockOverride as { reason: string; periods: Array<{ periodKey: string }> };
    assert.equal(meta.reason, reason);
    assert.ok(meta.periods.some((period) => period.periodKey === getThailandMonthKey(SALE_DAY)));
    assert.deepEqual(overrides.map((entry) => [entry.action, entry.reason]), [["ยกเลิกใบเพิ่มหนี้", reason]]);
    assert.ok(overrides[0].periodLabels.every((label) => !/^\d/.test(label)), "month labels without a day");
  });

  it("an edit touching the distributed month is locked the same way; the preview names the month", async () => {
    declare(DEBIT_DAY);
    const preview = await service.previewSupplierDebitNote(editInput(30, 120, 180), { debitId: "dn" });
    assert.deepEqual(preview.lockedPeriods?.map((period) => period.distributionNo), ["PD-1"]);
    await assert.rejects(service.updateSupplierDebitNote("dn", editInput(30, 120, 180), actor), /PD-1/);
    assert.equal(Number(store.debits[0].netAmount), 500);
    await service.updateSupplierDebitNote("dn", editInput(30, 120, 180), actor, { periodLockOverride: { allowed: true, reason: "แก้ราคาตามใบกำกับจริง" } });
    assert.equal(Number(store.debits[0].netAmount), 300);
    assert.deepEqual(overrides.map((entry) => entry.action), ["แก้ไขใบเพิ่มหนี้"]);
  });

  it("a header date change in a distributed posting month keeps R4's message, and passes with the override", async () => {
    declare(DEBIT_DAY);
    const earlier = getThailandDateKey(day(-3));
    const header = { ...editInput(50, 200, 300), debitDate: earlier };
    await assert.rejects(service.updateSupplierDebitNote("dn", header, actor), /แก้ไขวันที่ออก DN ไม่ได้: งวด .+ประกาศแบ่งกำไรแล้ว \(PD-1\)/);
    await service.updateSupplierDebitNote("dn", header, actor, { periodLockOverride: { allowed: true, reason: "แก้วันที่ตามเอกสารจริง" } });
    assert.equal(getThailandDateKey(store.debits[0].debitDate as Date), earlier);
    assert.ok(audits[0].meta?.periodLockOverride);
  });
});
