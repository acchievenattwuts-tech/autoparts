import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { addThailandDays, getThailandDateKey, getThailandMonthKey, parseDateOnlyToDate } from "@/lib/th-date";

type MoneyRow = { id: string; debitNo: string; status: string; netAmount: number; amountRemain: number; supplierId: string;
  supplierReferenceNo?: string; note?: string; reason?: string; subtotalAmount?: number; vatAmount?: number; vatRecoverable?: boolean;
  debitDate?: Date; receivedDate?: Date; dueDate?: Date; updatedAt: Date };
type LineRow = { id: string; debitNoteId: string; productId: string; purchaseItemId?: string | null; stockCardId?: string;
  inventoryAmount: number; varianceAmount: number;
  eligibleBaseQuantity?: number; vatAmount?: number; netAmount?: number; costAdjustmentAmount?: number;
  stockBefore?: number; avgCostBefore?: number; avgCostAfter?: number };
/** One SKU's card: onHand is the true (unrounded) qtyBalance, productStock the integer Product.stock. */
type Sku = { onHand: number; productStock: number; base: number; average: number;
  rows: Array<{ id: string; adjustment: number; priceBalance: number }> };
type PurchaseItemRow = { id: string; productId: string; quantity: number; showQty: number | null; unitScale: number | null;
  showUnitName: string; showPricePerUnit: number; costPrice: number; product: { code: string; name: string } };
type AmountChange = { before: number; after: number };
type PeriodWhere = { periodYear: number; periodMonth: number; status: string };
type Store = { heads: MoneyRow[]; lines: LineRow[]; skus: Record<string, Sku>; purchaseItems: PurchaseItemRow[];
  stockWrites: number; recalculated: string[]; audits: string[]; notifications: number;
  notified: Array<{ event: string; amountChange?: AmountChange }>; factCost: number; paid: number;
  failAudit: boolean; failFact: boolean; locks: string[]; clock: number;
  declared: (PeriodWhere & { distributionNo: string }) | null;
  /** Other DNs already committed (T4); heads[0] stays the DN under test. */
  others: MoneyRow[];
  /** The vat_registered_from setting (YYYY-MM-DD), null while the shop is not VAT-registered (V1). */
  registeredFrom: string | null; registrationReads: number };
type ReferenceWhere = { supplierId: string; status: string; id?: { not: string } };
const sku = (onHand = 4): Sku => ({ onHand, productStock: Math.round(onHand), base: 100, average: 100, rows: [] });
const purchaseItem = (id: string, productId: string): PurchaseItemRow => ({ id, productId, quantity: 10, showQty: null,
  unitScale: 1, showUnitName: "piece", showPricePerUnit: 100, costPrice: 100, product: { code: productId.toUpperCase(), name: "Golden product" } });
const initial = (): Store => ({ heads: [], lines: [], skus: { sku: sku(), "sku-2": sku() },
  purchaseItems: [purchaseItem("source-line", "sku"), purchaseItem("source-line-2", "sku-2")], stockWrites: 0, recalculated: [],
  audits: [], notifications: 0, notified: [], factCost: 0, paid: 0, failAudit: false, failFact: false, locks: [], clock: 0,
  declared: null, others: [], registeredFrom: null, registrationReads: 0 });
let store = initial();
/** Not rolled back with the transaction, so ordering inside a failed transaction stays observable. */
let events: string[] = [];
/** ProfitDistribution period reads; like events, kept across a rolled-back transaction. */
let periodQueries: PeriodWhere[] = [];
/** T4 duplicate-number reads; kept across a rolled-back transaction. */
let referenceQueries: ReferenceWhere[] = [];
/** generateSupplierDebitNo calls (a numbering write); kept across a rolled-back transaction. */
let docNumberCalls = 0;
/** A DN another transaction commits while ours is open: invisible to our pre-check, visible after our rollback. */
let concurrentDebit: MoneyRow | null = null;
let concurrentCommitted = false;
/** Raised by the next DN header write (create, or an update carrying supplierReferenceNo), as the database would. */
let pendingHeaderWriteError: Error | null = null;
const failHeaderWriteIfPending = (): void => {
  if (!pendingHeaderWriteError) return;
  const error = pendingHeaderWriteError;
  pendingHeaderWriteError = null; concurrentCommitted = true;
  throw error;
};
/** Mirrors @prisma/driver-adapter-utils: own enumerable name/cause, so they survive JSON.stringify like the real one. */
class DriverAdapterError extends Error {
  override name = "DriverAdapterError";
  override cause: unknown;
  constructor(payload: { kind: string; [field: string]: unknown }) { super(payload.kind); this.cause = payload; }
}
/** The P2002 Prisma 7 + adapter-pg raise for Postgres 23505: the index name is only in the driver's original message. */
const uniqueViolation = (index: string): Prisma.PrismaClientKnownRequestError => new Prisma.PrismaClientKnownRequestError(
  "Unique constraint failed on the fields: (`\"supplierId\"`,`upper(regexp_replace(\"supplierReferenceNo\"::text`)", {
    code: "P2002", clientVersion: "test", meta: { modelName: "SupplierDebitNote", driverAdapterError: new DriverAdapterError({
      kind: "UniqueConstraintViolation", originalCode: "23505",
      originalMessage: `duplicate key value violates unique constraint "${index}"`,
      constraint: { fields: ["\"supplierId\"", "upper(regexp_replace(\"supplierReferenceNo\"::text"] },
    }) } });
const originalPurchase = { id: "purchase", supplierId: "supplier", status: "ACTIVE", amountRemain: 0,
  purchaseDate: parseDateOnlyToDate("2026-01-01") };
const CLOCK_BASE = Date.parse("2026-09-30T03:00:00.000Z");
/** Prisma @updatedAt: every write moves the timestamp forward. */
const tick = (): Date => new Date(CLOCK_BASE + ++store.clock * 1000);
/** Full MAVG replay of a SKU's value-only rows, as recalculateStockCard does (quantity never changes). */
const replay = (card: Sku): void => {
  let running = card.base;
  for (const row of card.rows) {
    if (card.onHand <= 0 && row.adjustment !== 0) throw new Error("DN inventory adjustment requires positive stock");
    if (card.onHand > 0) running += row.adjustment / card.onHand;
    row.priceBalance = running;
  }
  card.average = running;
};
/** Posting date of the DN rows in this fixture (the DN always posts today). */
const debitPostingDate = (): Date => parseDateOnlyToDate(getThailandDateKey());
const tx = {
  $queryRaw: async (parts: TemplateStringsArray) => { store.locks.push(parts.join("?")); return []; },
  // Shared month-lock advisory locks (lib/period-lock.ts).
  $executeRaw: async () => 0,
  // lib/input-vat.ts reads the VAT registration date from SiteContent.
  siteContent: { findUnique: async () => {
    store.registrationReads += 1;
    return store.registeredFrom ? { value: store.registeredFrom } : null;
  } },
  purchase: { findUnique: async () => ({ ...originalPurchase, items: store.purchaseItems }) },
  purchaseItem: { findMany: async () => store.purchaseItems.map((item) => ({ productId: item.productId })) },
  product: { findMany: async (args: { where: { id: { in: string[] } } }) => args.where.id.in.map((id) =>
    ({ id, stock: store.skus[id].productStock, inventoryTracking: "TRACKED" })) },
  stockCard: {
    // The DN's own value-only rows: its original position per SKU (edit reposts there, T1).
    findMany: async () => Object.entries(store.skus).filter(([, card]) => card.rows.length > 0)
      .map(([productId]) => ({ productId, docDate: debitPostingDate(), valuationEpoch: 1 })),
    // Latest row by [productId, docDate desc, sorder desc]; the future-row check (docDate > today) finds nothing.
    findFirst: async (args: { where: { productId?: string; docDate?: { gt?: Date } } }) => {
      if (args.where.docDate?.gt || !args.where.productId) return null;
      const card = store.skus[args.where.productId];
      return { qtyBalance: card.onHand, priceBalance: card.rows.at(-1)?.priceBalance ?? card.base };
    },
    findUniqueOrThrow: async (args: { where: { id: string } }) => {
      const [productId] = args.where.id.split("#");
      return { priceBalance: store.skus[productId].rows.find((row) => row.id === args.where.id)?.priceBalance ?? 0 };
    },
    deleteMany: async () => {
      events.push("stockCard.deleteMany");
      for (const card of Object.values(store.skus)) card.rows = [];
      return { count: 1 };
    },
  },
  supplierDebitNote: {
    create: async ({ data }: { data: Omit<MoneyRow, "id" | "status" | "updatedAt"> }) => {
      failHeaderWriteIfPending();
      const id = store.heads.length === 0 ? "dn" : `dn-${store.heads.length + 1}`;
      const head = { ...data, id, status: "ACTIVE", updatedAt: tick() }; store.heads.push(head); return head;
    },
    findMany: async ({ where }: { where: ReferenceWhere }) => {
      referenceQueries.push(where);
      const committed = [...store.heads, ...store.others, ...(concurrentDebit && concurrentCommitted ? [concurrentDebit] : [])];
      return committed.filter((row) => row.supplierId === where.supplierId && row.status === where.status && row.id !== where.id?.not)
        .map((row) => ({ id: row.id, debitNo: row.debitNo, supplierReferenceNo: row.supplierReferenceNo }));
    },
    findUnique: async () => store.heads[0] ? { ...store.heads[0], items: store.lines.map((line) => ({ ...line })) } : null,
    findUniqueOrThrow: async () => ({ ...store.heads[0], netAmount: new Prisma.Decimal(store.heads[0].netAmount),
      items: store.lines, supplierPaymentItems: [{ paidAmount: store.paid }] }),
    update: async ({ data }: { data: Partial<MoneyRow> }) => {
      if (data.supplierReferenceNo !== undefined) failHeaderWriteIfPending();
      Object.assign(store.heads[0], data, { updatedAt: tick() }); return store.heads[0];
    },
  },
  supplierDebitNoteItem: {
    create: async ({ data }: { data: Omit<LineRow, "id"> }) => {
      const line = { ...data, id: `dn-line-${store.lines.length + 1}` }; store.lines.push(line); return line;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<LineRow> }) => {
      const line = store.lines.find((row) => row.id === where.id);
      assert.ok(line); Object.assign(line, data); return line;
    },
    deleteMany: async () => { const count = store.lines.length; store.lines = []; return { count }; },
  },
  factProfit: { updateMany: async () => { store.factCost = 0; return { count: 1 }; } },
  // findLockedPeriods (lib/period-lock.ts): one read per call, recorded here as one PeriodWhere per month.
  profitDistribution: { findMany: async ({ where }: { where: { activePeriodKey: { in: string[] }; status: string } }) =>
    where.activePeriodKey.in.flatMap((periodKey) => {
      const [year, month] = periodKey.split("-").map(Number);
      const query = { periodYear: year, periodMonth: month, status: where.status };
      periodQueries.push(query);
      const declared = store.declared;
      return declared && declared.status === query.status && declared.periodYear === year && declared.periodMonth === month
        ? [{ activePeriodKey: periodKey, distributionNo: declared.distributionNo }] : [];
    }) },
};
let service: typeof import("@/lib/supplier-debit-note");
before(async () => {
  await mock.module("@/lib/db", { namedExports: { dbTx: async (callback: (client: typeof tx) => Promise<unknown>) => {
    const snapshot = structuredClone(store);
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; }
  } } });
  await mock.module("@/lib/doc-number", { namedExports: { generateSupplierDebitNo: async () => {
    docNumberCalls += 1; return "SDN26090001";
  } } });
  await mock.module("@/lib/stock-card", { namedExports: {
    getStockValuationEpoch: async () => 0,
    writeStockCard: async (_client: unknown, input: { productId: string; qtyIn: number; qtyOut: number; valueAdjustment: number }) => {
      assert.equal(input.qtyIn, 0); assert.equal(input.qtyOut, 0);
      const card = store.skus[input.productId];
      const id = `${input.productId}#${card.rows.length + 1}`;
      card.rows.push({ id, adjustment: input.valueAdjustment, priceBalance: 0 });
      replay(card); // a SUPPLIER_DEBIT row always triggers a full replay of its SKU
      store.stockWrites += 1;
      return id;
    },
    recalculateStockCardMany: async (_client: unknown, productIds: Iterable<string>) => {
      for (const productId of productIds) { store.recalculated.push(productId); replay(store.skus[productId]); }
    },
  } });
  await mock.module("@/lib/profit-fact", { namedExports: { rebuildSupplierDebitProfitFacts: async () => {
    if (store.failFact) throw new Error("fact failure");
    store.factCost = store.lines.reduce((total, line) => total + line.varianceAmount, 0);
  } } });
  await mock.module("@/lib/audit-log", { namedExports: { writeAuditLogTx: async (_client: unknown, entry: { action: string }) => {
    if (store.failAudit) throw new Error("audit failure"); store.audits.push(entry.action);
  } } });
  await mock.module("@/lib/notifications", { namedExports: {
    notifySupplierDebitNote: async (debit: { amountChange?: AmountChange }, event: string) => {
      store.notifications += 1;
      store.notified.push({ event, ...(debit.amountChange ? { amountChange: debit.amountChange } : {}) });
    },
    safeNotifyPeriodLockOverride: async () => undefined,
  } });
  // T1 restatement has its own goldens (sale-cost-restatement, supplier-debit-restatement); here nothing follows the DN.
  await mock.module("@/lib/sale-cost-restatement", { namedExports: {
    planSaleCostRestatement: async () => ({ saleItems: [], returnRows: [], residualRows: [], creditNotes: [], unlinkedSaleRows: 0 }),
    restatementDates: () => [],
    summarizeSaleCostRestatement: () => ({ saleCount: 0, saleNos: [], saleNosTruncated: false, lineCount: 0, costBefore: 0, costAfter: 0,
      delta: 0, creditNoteCount: 0, creditNoteNos: [], returnRowCount: 0, residualRowCount: 0, unlinkedSaleRows: 0 }),
    applyRestatedReturnCosts: async () => undefined,
    applyRestatedSaleCosts: async () => undefined,
  } });
  await mock.module("@/lib/profit-cache", { namedExports: { revalidateProfitDashboardCache: () => undefined } });
  await mock.module("@/lib/document-mutation-guard", { namedExports: {
    // T1: an ACTIVE payment blocks a cancel; an edit keeps payments while its new net amount covers them.
    createDocumentMutationGuard: () => ({ check: async (_type: string, _id: string, action: string) =>
      ({ reason: action === "cancel" && store.paid > 0 ? "paid DN blocked" : null }) }),
    buildMutationBlockMessage: (result: { reason: string | null }) => result.reason,
  } });
  service = await import("@/lib/supplier-debit-note");
});
beforeEach(() => {
  store = initial(); events = []; referenceQueries = []; docNumberCalls = 0;
  concurrentDebit = null; concurrentCommitted = false; pendingHeaderWriteError = null;
});
// vatRecoverable: true mimics a stale browser; the server must ignore it (it decides recoverability itself, V1).
const input = () => ({ purchaseId: "purchase", supplierReferenceNo: "SUP-DN-1", debitDate: getThailandDateKey(),
  receivedDate: getThailandDateKey(), dueDate: getThailandDateKey(), reason: "price correction", note: "",
  vatType: "NO_VAT", vatRate: 0, vatRecoverable: true, expectedInventoryAmount: 200, expectedVarianceAmount: 300,
  items: [{ purchaseItemId: "source-line", amountMode: "PER_UNIT", increaseAmount: 50, affectedQuantity: 10 }] });
/** What the edit form loaded: the DN's current updatedAt. */
const loaded = () => ({ expectedUpdatedAt: store.heads[0].updatedAt.toISOString() });

describe("supplier DN: service golden orchestration with isolated transactional fixture", () => {
  it("rejects VAT/money precision beyond persisted two decimals", () => {
    assert.equal(service.supplierDebitNoteSchema.safeParse({ ...input(), vatRate: 7.125 }).success, false);
    assert.equal(service.supplierDebitNoteSchema.safeParse({ ...input(), items: [{ ...input().items[0], increaseAmount: 50.001 }] }).success, false);
    assert.equal(store.heads.length, 0);
  });
  it("wrong source line or quantity beyond original receipt causes no writes", async () => {
    await assert.rejects(service.postSupplierDebitNote({ ...input(), items: [{ ...input().items[0], purchaseItemId: "foreign" }] }, { userId: "actor" }), /ไม่ได้อยู่ในใบซื้อ/);
    await assert.rejects(service.postSupplierDebitNote({ ...input(), items: [{ ...input().items[0], affectedQuantity: 11 }] }, { userId: "actor" }), /เกินจำนวนรับ/);
    assert.equal(store.heads.length, 0); assert.equal(store.stockWrites, 0); assert.equal(store.notifications, 0);
  });
  it("paid original purchase stays intact; DN adds 500 AP, 200 inventory, 300 period cost", async () => {
    const result = await service.postSupplierDebitNote(input(), { userId: "actor" });
    assert.equal(result.debitNo, "SDN26090001");
    assert.equal(originalPurchase.amountRemain, 0);
    assert.equal(store.purchaseItems[0].costPrice, 100);
    assert.equal(store.heads[0].amountRemain, 500);
    assert.equal(store.factCost, 300);
    assert.equal(store.skus.sku.onHand, 4); assert.equal(store.skus.sku.average, 150);
    assert.deepEqual(store.audits, ["CREATE"]); assert.equal(store.notifications, 1);
    assert.match(store.locks[0], /Purchase.*FOR UPDATE/);
    assert.match(store.locks[1], /Product.*ORDER BY id FOR UPDATE/);
  });
  it("preview has no writes, audit, AP or notification", async () => {
    assert.deepEqual(await service.previewSupplierDebitNote(input()), {
      subtotalAmount: 500, vatAmount: 0, netAmount: 500, inventoryAmount: 200, varianceAmount: 300,
    });
    assert.equal(store.heads.length, 0); assert.equal(store.stockWrites, 0); assert.equal(store.notifications, 0);
  });
  it("preview of an incomplete form (no reason) rejects without an error log; a service failure still logs", async (t) => {
    const logged = t.mock.method(console, "error", () => undefined);
    const previewLogs = () => logged.mock.calls.filter((call) => call.arguments[0] === "[previewSupplierDebitNote]").length;
    await assert.rejects(service.previewSupplierDebitNote({ ...input(), reason: "  " }), /กรุณาระบุเหตุผล/);
    assert.equal(logged.mock.callCount(), 0);
    await assert.rejects(service.previewSupplierDebitNote({ ...input(), items: [{ ...input().items[0], affectedQuantity: 11 }] }), /เกินจำนวนรับ/);
    assert.equal(previewLogs(), 1);
  });
  it("stale preview after a concurrent stock change rejects before writes", async () => {
    store.skus.sku = { ...store.skus.sku, onHand: 3, productStock: 3 };
    await assert.rejects(service.postSupplierDebitNote(input(), { userId: "actor" }), /ยอดจัดสรรต้นทุนเปลี่ยน/);
    assert.equal(store.heads.length, 0); assert.equal(store.stockWrites, 0); assert.equal(store.notifications, 0);
  });
  it("zero stock recognizes 500 variance without carrying inventory value", async () => {
    store.skus.sku = { ...store.skus.sku, onHand: 0, productStock: 0 };
    await service.postSupplierDebitNote({ ...input(), expectedInventoryAmount: 0, expectedVarianceAmount: 500 }, { userId: "actor" });
    assert.equal(store.skus.sku.onHand, 0); assert.equal(store.factCost, 500); assert.equal(store.heads[0].amountRemain, 500);
  });
  for (const failure of ["failAudit", "failFact"] as const) {
    it(`${failure} rolls back header/items/stock/profit and sends no notification`, async () => {
      store[failure] = true;
      await assert.rejects(service.postSupplierDebitNote(input(), { userId: "actor" }), /failure/);
      assert.equal(store.heads.length, 0); assert.equal(store.lines.length, 0);
      assert.equal(store.skus.sku.average, 100); assert.equal(store.stockWrites, 0); assert.equal(store.notifications, 0);
    });
  }
  it("partial and full payment recalculate independent DN balance", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    store.paid = 125; await service.recalculateSupplierDebitRemain(tx as unknown as Prisma.TransactionClient, "dn");
    assert.equal(Number(store.heads[0].amountRemain), 375);
    store.paid = 500; await service.recalculateSupplierDebitRemain(tx as unknown as Prisma.TransactionClient, "dn");
    assert.equal(Number(store.heads[0].amountRemain), 0);
    store.paid = 0; await service.recalculateSupplierDebitRemain(tx as unknown as Prisma.TransactionClient, "dn");
    assert.equal(Number(store.heads[0].amountRemain), 500);
  });
  it("paid DN cancellation is blocked with no reversal side effects", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" }); store.paid = 100;
    await assert.rejects(service.cancelSupplierDebitNote("dn", "cancel", { userId: "actor" }), /paid DN blocked/);
    assert.equal(store.heads[0].status, "ACTIVE"); assert.equal(store.factCost, 300);
    assert.equal(store.skus.sku.average, 150); assert.deepEqual(store.audits, ["CREATE"]); assert.equal(store.notifications, 1);
  });
  it("unpaid last DN cancellation restores cost and clears AP/current cost", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await service.cancelSupplierDebitNote("dn", "cancel", { userId: "actor" });
    assert.equal(store.heads[0].status, "CANCELLED"); assert.equal(store.heads[0].amountRemain, 0);
    assert.equal(store.factCost, 0); assert.equal(store.skus.sku.average, 100);
    assert.deepEqual(store.audits, ["CREATE", "CANCEL"]); assert.equal(store.notifications, 2);
  });
  it("header-only edit keeps stock, AP and cost untouched even after payment", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" }); store.paid = 100;
    const result = await service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), supplierReferenceNo: "SUP-DN-1A", note: "corrected ref",
      expectedInventoryAmount: undefined, expectedVarianceAmount: undefined }, { userId: "actor" });
    assert.deepEqual(result, { id: "dn", debitNo: "SDN26090001", reposted: false });
    assert.equal(store.heads[0].supplierReferenceNo, "SUP-DN-1A");
    assert.equal(store.skus.sku.average, 150); assert.equal(store.factCost, 300); assert.equal(store.heads[0].amountRemain, 500);
    assert.deepEqual(store.audits, ["CREATE", "UPDATE"]); assert.equal(store.notifications, 2);
  });
  it("line edit reverses the posted value and reposts under the same DN number", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    const edited = { ...input(), ...loaded(), expectedInventoryAmount: 120, expectedVarianceAmount: 180,
      items: [{ ...input().items[0], increaseAmount: 30 }] };
    // The edit form previews while the old DN is still posted; the repost must agree with it (F4).
    const preview = await service.previewSupplierDebitNote(edited);
    assert.deepEqual([preview.inventoryAmount, preview.varianceAmount], [120, 180]);
    const result = await service.updateSupplierDebitNote("dn", edited, { userId: "actor" });
    assert.deepEqual(result, { id: "dn", debitNo: "SDN26090001", reposted: true });
    assert.equal(store.heads[0].netAmount, 300); assert.equal(Number(store.heads[0].amountRemain), 300);
    assert.equal(store.lines.length, 1); assert.equal(store.skus.sku.average, 130); assert.equal(store.factCost, 180);
    assert.deepEqual(store.audits, ["CREATE", "UPDATE"]); assert.equal(store.notifications, 2);
    // Retained SKU is not pre-replayed (F5), yet its snapshots equal a full replay: 4 on hand @ 100 before, 100 + 120 / 4 after.
    assert.deepEqual(store.recalculated, []);
    assert.deepEqual(store.lines.map((line) => [line.stockBefore, line.avgCostBefore, line.avgCostAfter]), [[4, 100, 130]]);
  });
  it("T1: a line edit keeps a payment its new net covers (paid 100, net 300 -> remain 200)", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    store.paid = 100; store.heads[0].amountRemain = 400;
    const edited = { ...input(), ...loaded(), expectedInventoryAmount: 120, expectedVarianceAmount: 180, items: [{ ...input().items[0], increaseAmount: 30 }] };
    await service.updateSupplierDebitNote("dn", edited, { userId: "actor" });
    assert.equal(store.heads[0].netAmount, 300); assert.equal(Number(store.heads[0].amountRemain), 200);
    assert.equal(store.skus.sku.average, 130); assert.deepEqual(store.audits, ["CREATE", "UPDATE"]);
  });
  it("T1: a line edit below the amount already paid is rejected with no reversal side effects", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    store.paid = 400; store.heads[0].amountRemain = 100;
    const edited = { ...input(), ...loaded(), expectedInventoryAmount: 120, expectedVarianceAmount: 180, items: [{ ...input().items[0], increaseAmount: 30 }] };
    events = [];
    await assert.rejects(service.updateSupplierDebitNote("dn", edited, { userId: "actor" }), /ต่ำกว่ายอดที่จ่ายชำระแล้ว 400\.00 บาท/);
    assert.equal(store.heads[0].netAmount, 500); assert.equal(store.lines.length, 1); assert.deepEqual(events, []);
    assert.equal(store.skus.sku.average, 150); assert.equal(store.factCost, 300); assert.deepEqual(store.audits, ["CREATE"]);
  });
  it("line edit without a fresh preview and a changed source purchase are both rejected", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), items: [{ ...input().items[0], increaseAmount: 30 }] }, { userId: "actor" }), /ตรวจยอด/);
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), purchaseId: "other" }, { userId: "actor" }), /เปลี่ยนใบซื้อ/);
    assert.equal(store.heads[0].netAmount, 500); assert.equal(store.skus.sku.average, 150); assert.deepEqual(store.audits, ["CREATE"]);
  });
  it("cancelled DN cannot be edited", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await service.cancelSupplierDebitNote("dn", "cancel", { userId: "actor" });
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...loaded() }, { userId: "actor" }), /เฉพาะ DN ที่ใช้งาน/);
  });
});

describe("supplier DN review fixes (2026-09-30): VAT policy, header VAT, true coverage, concurrency, repost order", () => {
  const twoLines = (increaseAmount: number, amountMode: "PER_UNIT" | "TOTAL" = "PER_UNIT", affectedQuantity = 10) => [
    { purchaseItemId: "source-line", amountMode, increaseAmount, affectedQuantity },
    { purchaseItemId: "source-line-2", amountMode, increaseAmount, affectedQuantity },
  ];

  it("V1 not registered: client vatRecoverable=true is ignored; 50 x 10 excl. 7% capitalizes AP 535 -> 214 stock / 321 variance", async () => {
    // Cost = net 535 (VAT not claimable); 4 of 10 covered -> 535 x 4 / 10 = 214; MAVG 100 + 214 / 4 = 153.5.
    await service.postSupplierDebitNote({ ...input(), vatType: "EXCLUDING_VAT", vatRate: 7,
      expectedInventoryAmount: 214, expectedVarianceAmount: 321 }, { userId: "actor" });
    assert.equal(store.heads[0].vatRecoverable, false);
    assert.deepEqual([store.heads[0].subtotalAmount, store.heads[0].vatAmount, store.heads[0].netAmount], [500, 35, 535]);
    assert.equal(store.lines[0].costAdjustmentAmount, 535);
    assert.equal(store.skus.sku.average, 153.5); assert.equal(store.factCost, 321);
  });

  it("V1 registered on the DN date: 50 x 10 excl. 7% keeps VAT 35 as input tax -> 200 stock / 300 variance, AP still 535", async () => {
    // Cost = subtotal 500; 4 of 10 covered -> 200; MAVG 100 + 200 / 4 = 150.
    store.registeredFrom = getThailandDateKey();
    await service.postSupplierDebitNote({ ...input(), vatType: "EXCLUDING_VAT", vatRate: 7,
      expectedInventoryAmount: 200, expectedVarianceAmount: 300 }, { userId: "actor" });
    assert.equal(store.heads[0].vatRecoverable, true);
    assert.deepEqual([store.heads[0].subtotalAmount, store.heads[0].vatAmount, store.heads[0].netAmount, store.heads[0].amountRemain],
      [500, 35, 535, 535]);
    assert.deepEqual([store.lines[0].costAdjustmentAmount, store.lines[0].inventoryAmount, store.lines[0].varianceAmount], [500, 200, 300]);
    assert.equal(store.skus.sku.average, 150); assert.equal(store.factCost, 300);
  });

  it("V1 registered after the supplier's DN date: the VAT stays cost (214 / 321) in preview and posting", async () => {
    store.registeredFrom = getThailandDateKey();
    const yesterday = getThailandDateKey(addThailandDays(parseDateOnlyToDate(getThailandDateKey()), -1));
    const dn = { ...input(), debitDate: yesterday, vatType: "EXCLUDING_VAT", vatRate: 7, expectedInventoryAmount: 214, expectedVarianceAmount: 321 };
    assert.deepEqual(await service.previewSupplierDebitNote(dn),
      { subtotalAmount: 500, vatAmount: 35, netAmount: 535, inventoryAmount: 214, varianceAmount: 321 });
    await service.postSupplierDebitNote(dn, { userId: "actor" });
    assert.equal(store.heads[0].vatRecoverable, false); assert.equal(store.lines[0].costAdjustmentAmount, 535);
  });

  it("V1: a NO_VAT DN never reads the registration setting", async () => {
    store.registeredFrom = getThailandDateKey();
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    assert.equal(store.heads[0].vatRecoverable, false); assert.equal(store.registrationReads, 0);
  });

  it("D9: two 10.05 lines excl. 7% store document VAT 1.41 / AP 21.51 (per-line rounding gave 1.40 / 21.50)", async () => {
    // 20.10 x 7% = 1.407 -> 1.41; 141 satang / 2 = 70.5 each, the leftover satang goes to line 1.
    // Each SKU has 4 on hand and 1 affected unit, so each line is fully capitalized.
    await service.postSupplierDebitNote({ ...input(), vatType: "EXCLUDING_VAT", vatRate: 7, items: twoLines(10.05, "TOTAL", 1),
      expectedInventoryAmount: 21.51, expectedVarianceAmount: 0 }, { userId: "actor" });
    assert.deepEqual([store.heads[0].subtotalAmount, store.heads[0].vatAmount, store.heads[0].netAmount], [20.1, 1.41, 21.51]);
    assert.deepEqual(store.lines.map((line) => [line.vatAmount, line.netAmount, line.inventoryAmount]), [[0.71, 10.76, 10.76], [0.7, 10.75, 10.75]]);
  });

  it("D12: coverage uses the true 0.5 on hand, not Product.stock rounded to 1 -> MAVG 150, not 200", async () => {
    // Received 10 @ 100, sold 9.5: qtyBalance 0.5, Product.stock = Math.round(0.5) = 1.
    // DN +50 x 10 = 500; 0.5 of 10 covered -> stock 25, variance 475; MAVG (0.5 x 100 + 25) / 0.5 = 150.
    // Coverage from Product.stock would capitalize 50 -> (50 + 50) / 0.5 = 200.
    store.skus.sku = { ...store.skus.sku, onHand: 0.5, productStock: 1 };
    await service.postSupplierDebitNote({ ...input(), expectedInventoryAmount: 25, expectedVarianceAmount: 475 }, { userId: "actor" });
    assert.deepEqual([store.lines[0].eligibleBaseQuantity, store.lines[0].inventoryAmount, store.lines[0].varianceAmount], [0.5, 25, 475]);
    assert.equal(store.skus.sku.average, 150);
  });

  it("D12: integer stock is byte-identical to Product.stock coverage (4 on hand -> 200 / 300, MAVG 150)", async () => {
    assert.equal(store.skus.sku.productStock, store.skus.sku.onHand);
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    assert.deepEqual([store.lines[0].eligibleBaseQuantity, store.lines[0].inventoryAmount, store.lines[0].varianceAmount], [4, 200, 300]);
    assert.equal(store.skus.sku.average, 150);
  });

  it("D12: affected quantity is capped by the unrounded receipt 2.5 (PurchaseItem.quantity rounds to 3)", async () => {
    store.purchaseItems[0] = { ...store.purchaseItems[0], quantity: 3, showQty: 2.5, unitScale: 1 };
    await assert.rejects(service.previewSupplierDebitNote({ ...input(), items: [{ ...input().items[0], affectedQuantity: 2.6 }] }), /เกินจำนวนรับ/);
    assert.equal((await service.previewSupplierDebitNote({ ...input(), items: [{ ...input().items[0], affectedQuantity: 2.5 }] })).netAmount, 125);
  });

  it("D12: integer pack receipts keep the same cap (2 packs x 5 = 10 base)", async () => {
    store.purchaseItems[0] = { ...store.purchaseItems[0], quantity: 10, showQty: 2, unitScale: 5 };
    const packs = (affectedQuantity: number) => ({ ...input(), items: [{ ...input().items[0], affectedQuantity, increaseAmount: 250 }] });
    assert.equal((await service.previewSupplierDebitNote(packs(2))).netAmount, 500);
    await assert.rejects(service.previewSupplierDebitNote(packs(2.2)), /เกินจำนวนรับ/);
  });

  it("ก5: a fractional receipt stored exactly (quantity 20.5 base, no display qty) caps the DN at 20.5", async () => {
    // The fixture store is structured-cloned per transaction, so the Decimal(12,4) column is a plain number here.
    store.purchaseItems[0] = { ...store.purchaseItems[0], quantity: 20.5, showQty: null, unitScale: 1 };
    const affected = (affectedQuantity: number) => ({ ...input(), items: [{ ...input().items[0], affectedQuantity }] });
    await assert.rejects(service.previewSupplierDebitNote(affected(20.6)), /เกินจำนวนรับ/);
    assert.equal((await service.previewSupplierDebitNote(affected(20.5))).netAmount, 1025);
  });

  it("D19: affected quantity allows at most 4 decimals, with a Thai message", () => {
    const tooPrecise = service.supplierDebitNoteSchema.safeParse({ ...input(), items: [{ ...input().items[0], affectedQuantity: 1.00001 }] });
    assert.equal(tooPrecise.success, false);
    assert.match(tooPrecise.error?.issues[0]?.message ?? "", /ไม่เกิน 4 ทศนิยม/);
    assert.equal(service.supplierDebitNoteSchema.safeParse({ ...input(), items: [{ ...input().items[0], affectedQuantity: 1.0001 }] }).success, true);
  });

  it("F3: an edit saved from a stale copy is rejected before any write", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    const staleCopy = loaded();
    await service.updateSupplierDebitNote("dn", { ...input(), ...staleCopy, note: "first editor" }, { userId: "actor" });
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...staleCopy, note: "second editor" }, { userId: "actor" }),
      (error: unknown) => error instanceof service.SupplierDebitStaleError && /ถูกแก้ไขโดยผู้อื่น/.test(error.message));
    assert.equal(store.heads[0].note, "first editor"); assert.deepEqual(store.audits, ["CREATE", "UPDATE"]);
  });

  it("F3: an edit without the loaded updatedAt is refused with a Thai reload message", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await assert.rejects(service.updateSupplierDebitNote("dn", input(), { userId: "actor" }), /กรุณาโหลดหน้าใหม่/);
    assert.deepEqual(store.audits, ["CREATE"]);
  });

  it("F4: a repost with a stale preview is rejected before the posted stock rows are reversed", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    events = [];
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), expectedInventoryAmount: 999,
      expectedVarianceAmount: 0, items: [{ ...input().items[0], increaseAmount: 30 }] }, { userId: "actor" }),
    (error: unknown) => error instanceof service.SupplierDebitPreviewRequiredError);
    assert.deepEqual(events, []);
  });

  it("F5: dropping a SKU replays only that SKU; the retained SKU's snapshots equal a full replay", async () => {
    await service.postSupplierDebitNote({ ...input(), items: twoLines(50), expectedInventoryAmount: 400, expectedVarianceAmount: 600 }, { userId: "actor" });
    assert.deepEqual([store.skus.sku.average, store.skus["sku-2"].average], [150, 150]);
    await service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), expectedInventoryAmount: 120, expectedVarianceAmount: 180,
      items: [{ ...input().items[0], increaseAmount: 30 }] }, { userId: "actor" });
    assert.deepEqual(store.recalculated, ["sku-2"]);
    assert.equal(store.skus["sku-2"].average, 100);
    assert.deepEqual(store.lines.map((line) => [line.productId, line.stockBefore, line.avgCostBefore, line.avgCostAfter]), [["sku", 4, 100, 130]]);
    assert.equal(store.skus.sku.average, 130);
  });

  it("F8: a reposted edit reports the AP change 500 -> 300; a header-only edit does not", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), note: "header only" }, { userId: "actor" });
    await service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), expectedInventoryAmount: 120, expectedVarianceAmount: 180,
      items: [{ ...input().items[0], increaseAmount: 30 }] }, { userId: "actor" });
    assert.deepEqual(store.notified, [{ event: "created" }, { event: "updated" }, { event: "updated", amountChange: { before: 500, after: 300 } }]);
  });
});

const storedKey = (value: unknown): string => {
  assert.ok(value instanceof Date);
  return getThailandDateKey(value);
};

describe("V1: an edited DN keeps its stored VAT recoverability until what decides it changes", () => {
  const dayKey = (offset: number): string => getThailandDateKey(addThailandDays(parseDateOnlyToDate(getThailandDateKey()), offset));
  /** 50 x 10 excluding 7% on the fixture's 4 of 10 on hand. */
  const vatDebit = (debitDate: string, [inventory, variance]: [number, number]) => ({ ...input(), debitDate, vatType: "EXCLUDING_VAT",
    vatRate: 7, expectedInventoryAmount: inventory, expectedVarianceAmount: variance });
  const edit = (changes: Record<string, unknown>) =>
    service.updateSupplierDebitNote("dn", { ...changes, ...loaded() }, { userId: "actor" });

  it("a DN-date change that makes the VAT recoverable reposts: 214 / 321 -> 200 / 300, MAVG 153.5 -> 150", async () => {
    store.registeredFrom = dayKey(0);
    await service.postSupplierDebitNote(vatDebit(dayKey(-1), [214, 321]), { userId: "actor" });
    assert.equal(store.heads[0].vatRecoverable, false); assert.equal(store.skus.sku.average, 153.5);
    const result = await edit(vatDebit(dayKey(0), [200, 300]));
    assert.equal(result.reposted, true);
    assert.equal(store.heads[0].vatRecoverable, true); assert.equal(store.heads[0].netAmount, 535);
    assert.deepEqual([store.lines[0].costAdjustmentAmount, store.lines[0].inventoryAmount, store.lines[0].varianceAmount], [500, 200, 300]);
    assert.equal(store.skus.sku.average, 150); assert.equal(store.factCost, 300);
  });

  it("the flip needs a fresh preview: the header-only allocation 214 / 321 is rejected before any write", async () => {
    store.registeredFrom = dayKey(0);
    await service.postSupplierDebitNote(vatDebit(dayKey(-1), [214, 321]), { userId: "actor" });
    events = [];
    await assert.rejects(edit(vatDebit(dayKey(0), [214, 321])), (error: unknown) => error instanceof service.SupplierDebitPreviewRequiredError);
    assert.deepEqual(events, []); assert.equal(store.heads[0].vatRecoverable, false);
  });

  it("a DN-date change that keeps recoverability stays header-only", async () => {
    store.registeredFrom = dayKey(-2);
    await service.postSupplierDebitNote(vatDebit(dayKey(-1), [200, 300]), { userId: "actor" });
    const writes = store.stockWrites;
    const result = await edit(vatDebit(dayKey(0), [200, 300]));
    assert.equal(result.reposted, false); assert.equal(store.stockWrites, writes);
    assert.equal(store.heads[0].vatRecoverable, true); assert.equal(storedKey(store.heads[0].debitDate), dayKey(0));
  });

  it("no automatic repost: a note edit keeps the stored 'cost' decision after the shop registers", async () => {
    await service.postSupplierDebitNote(vatDebit(dayKey(0), [214, 321]), { userId: "actor" });
    store.registeredFrom = dayKey(-1);
    const writes = store.stockWrites;
    const result = await edit({ ...vatDebit(dayKey(0), [214, 321]), note: "แนบใบกำกับแล้ว" });
    assert.equal(result.reposted, false); assert.equal(store.stockWrites, writes);
    assert.equal(store.heads[0].vatRecoverable, false); assert.equal(store.skus.sku.average, 153.5);
    // The edit preview of the unchanged DN keeps the stored allocation too.
    const preview = await service.previewSupplierDebitNote(vatDebit(dayKey(0), [214, 321]), { debitId: "dn" });
    assert.deepEqual([preview.inventoryAmount, preview.varianceAmount], [214, 321]);
  });

  it("a line edit decides it again: 30 x 10 excl. 7% after registration -> cost 300 -> 120 / 180", async () => {
    await service.postSupplierDebitNote(vatDebit(dayKey(0), [214, 321]), { userId: "actor" });
    store.registeredFrom = dayKey(-1);
    const result = await edit({ ...vatDebit(dayKey(0), [120, 180]), items: [{ ...input().items[0], increaseAmount: 30 }] });
    assert.equal(result.reposted, true); assert.equal(store.heads[0].vatRecoverable, true);
    assert.deepEqual([store.heads[0].vatAmount, store.heads[0].netAmount, store.lines[0].costAdjustmentAmount], [21, 321, 300]);
  });
});

describe("supplier DN review round 3: cleared source links (R1) and header date policy (R4)", () => {
  const dayKey = (offset: number): string => getThailandDateKey(addThailandDays(parseDateOnlyToDate(getThailandDateKey()), offset));
  /** Issued yesterday and received today, so the received date can move back a day without breaking date order. */
  const posted = () => ({ ...input(), debitDate: dayKey(-1) });
  const edit = (changes: Record<string, unknown>) => ({ ...posted(), ...loaded(), ...changes });
  const run = (changes: Record<string, unknown>) => service.updateSupplierDebitNote("dn", edit(changes), { userId: "actor" });
  const runRepost = (changes: Record<string, unknown>) => run({ expectedInventoryAmount: 120, expectedVarianceAmount: 180,
    items: [{ ...input().items[0], increaseAmount: 30 }], ...changes });
  const postingMonth = (): PeriodWhere => {
    const [year, month] = getThailandMonthKey(parseDateOnlyToDate(getThailandDateKey())).split("-");
    return { periodYear: Number(year), periodMonth: Number(month), status: "ACTIVE" };
  };
  const declarePostingMonth = (): void => { store.declared = { ...postingMonth(), distributionNo: "PD26090001" }; };
  /** A payment settled the DN in full, so recalculateSupplierDebitRemain left no balance. */
  const settle = (): void => { store.paid = 500; store.heads[0].amountRemain = 0; };
  const assertNothingWritten = (): void => {
    assert.deepEqual(store.audits, ["CREATE"]); assert.equal(store.notifications, 1); assert.deepEqual(events, []);
    assert.equal(store.heads[0].netAmount, 500); assert.equal(store.lines.length, 1); assert.equal(store.skus.sku.average, 150);
  };
  const storedDate = (field: "debitDate" | "receivedDate" | "dueDate"): string => {
    const value = store.heads[0][field];
    assert.ok(value instanceof Date);
    return getThailandDateKey(value);
  };

  beforeEach(async () => {
    await service.postSupplierDebitNote(posted(), { userId: "actor" });
    events = []; periodQueries = [];
  });

  it("R1: an edit that meets a cleared source link is rejected in Thai before any write, header-only or repost", async () => {
    store.lines[0].purchaseItemId = null;
    await assert.rejects(run({ note: "header only" }), /บรรทัดใบซื้อต้นทางบางรายการถูกแก้ไขแล้ว/);
    await assert.rejects(runRepost({}), /บรรทัดใบซื้อต้นทางบางรายการถูกแก้ไขแล้ว/);
    assert.equal(store.heads[0].note, ""); assertNothingWritten();
  });

  it("R1: a cleared source link never counts as the same posting", () => {
    const parsed = service.supplierDebitNoteSchema.parse(posted());
    const current = (purchaseItemId: string | null) => ({ vatType: "NO_VAT", vatRate: new Prisma.Decimal(0),
      items: [{ purchaseItemId, amountMode: "PER_UNIT", increaseAmount: new Prisma.Decimal(50), affectedQuantity: new Prisma.Decimal(10) }],
    }) as unknown as Parameters<typeof service.isSameSupplierDebitPosting>[0];
    assert.equal(service.isSameSupplierDebitPosting(current("source-line"), parsed), true);
    assert.equal(service.isSameSupplierDebitPosting(current(null), parsed), false);
  });

  it("R4: a fully paid DN rejects a due-date change, naming the field and reason, before any write", async () => {
    settle();
    await assert.rejects(run({ dueDate: dayKey(30) }), /แก้ไขวันครบกำหนดชำระไม่ได้: DN นี้ชำระครบแล้ว ไม่มียอดค้างจ่าย/);
    assert.equal(storedDate("dueDate"), dayKey(0)); assertNothingWritten();
    assert.deepEqual(periodQueries, [], "a settled DN locks every date without reading the period");
  });

  it("R4: after full payment in a declared month, note, reason and supplier reference still change with an audit", async () => {
    settle(); declarePostingMonth();
    const result = await run({ note: "after payment", reason: "corrected reason", supplierReferenceNo: "SUP-DN-1B" });
    assert.equal(result.reposted, false);
    assert.deepEqual([store.heads[0].note, store.heads[0].reason, store.heads[0].supplierReferenceNo], ["after payment", "corrected reason", "SUP-DN-1B"]);
    assert.deepEqual(store.audits, ["CREATE", "UPDATE"]); assert.equal(store.skus.sku.average, 150); assert.equal(store.factCost, 300);
    assert.deepEqual(periodQueries, [], "no date changed, so no lock is read");
  });

  it("R4: a fully paid DN also locks the debit and received dates", async () => {
    settle();
    await assert.rejects(run({ debitDate: dayKey(-2) }), /แก้ไขวันที่ออก DN ไม่ได้: DN นี้ชำระครบแล้ว/);
    await assert.rejects(run({ receivedDate: dayKey(-1) }), /แก้ไขวันที่ได้รับไม่ได้: DN นี้ชำระครบแล้ว/);
    assert.equal(storedDate("debitDate"), dayKey(-1)); assert.equal(storedDate("receivedDate"), dayKey(0)); assertNothingWritten();
  });

  it("R4: a declared posting month locks the debit and received dates of an open DN, before any write", async () => {
    declarePostingMonth();
    await assert.rejects(run({ receivedDate: dayKey(-1) }),
      /แก้ไขวันที่ได้รับไม่ได้: งวด .+ ซึ่งเป็นเดือนที่ลงต้นทุน DN นี้ ประกาศแบ่งกำไรแล้ว \(PD26090001\)/);
    await assert.rejects(run({ debitDate: dayKey(-2) }), /แก้ไขวันที่ออก DN ไม่ได้: งวด .+ประกาศแบ่งกำไรแล้ว \(PD26090001\)/);
    assert.deepEqual(periodQueries, [postingMonth(), postingMonth()]); assertNothingWritten();
  });

  it("R4: the date policy is checked before a line repost reverses any stock row", async () => {
    declarePostingMonth();
    await assert.rejects(runRepost({ receivedDate: dayKey(-1) }), /แก้ไขวันที่ได้รับไม่ได้/);
    assertNothingWritten();
  });

  it("R4: a declared month does not lock the due date while a balance remains", async () => {
    declarePostingMonth();
    assert.equal((await run({ dueDate: dayKey(30) })).reposted, false);
    assert.equal(storedDate("dueDate"), dayKey(30)); assert.deepEqual(store.audits, ["CREATE", "UPDATE"]);
  });

  it("R4: an open DN in an undeclared month may change every header date", async () => {
    await run({ debitDate: dayKey(-2), receivedDate: dayKey(-1), dueDate: dayKey(30) });
    assert.deepEqual([storedDate("debitDate"), storedDate("receivedDate"), storedDate("dueDate")], [dayKey(-2), dayKey(-1), dayKey(30)]);
    assert.deepEqual(periodQueries, [postingMonth()]); assert.deepEqual(store.audits, ["CREATE", "UPDATE"]);
  });

  it("R4: the lock reads the Thailand month of postingDate and yields one shared message per field", async () => {
    // 2026-10-01 00:00 in Bangkok is 2026-09-30 17:00 UTC; a UTC month would check September.
    const queries: Array<{ activePeriodKey: { in: string[] }; status: string }> = [];
    // The shared month lock (lib/period-lock.ts): a shared advisory lock, then one read of the declared months.
    const client = { $executeRaw: async () => 0, profitDistribution: {
      findMany: async ({ where }: { where: { activePeriodKey: { in: string[] }; status: string } }) => {
        queries.push(where); return [{ activePeriodKey: "2026-10", distributionNo: "PD26110001" }];
      } } } as unknown as Prisma.TransactionClient;
    const locks = await service.getSupplierDebitHeaderLocksForDebit(client,
      { amountRemain: new Prisma.Decimal(10), postingDate: parseDateOnlyToDate("2026-10-01") });
    assert.deepEqual(queries, [{ activePeriodKey: { in: ["2026-10"] }, status: "ACTIVE" }]);
    assert.deepEqual(locks, {
      debitDate: "แก้ไขวันที่ออก DN ไม่ได้: งวด ตุลาคม 2026 ซึ่งเป็นเดือนที่ลงต้นทุน DN นี้ ประกาศแบ่งกำไรแล้ว (PD26110001)",
      receivedDate: "แก้ไขวันที่ได้รับไม่ได้: งวด ตุลาคม 2026 ซึ่งเป็นเดือนที่ลงต้นทุน DN นี้ ประกาศแบ่งกำไรแล้ว (PD26110001)",
      dueDate: null,
    });
    assert.deepEqual(service.getSupplierDebitHeaderLocks({ amountRemain: 0.01, declaredPeriod: null }),
      { debitDate: null, receivedDate: null, dueDate: null });
  });
});

describe("supplier DN T4 (2026-09-30): a supplier DN number is unique among ACTIVE DNs only", () => {
  const ACTIVE_INDEX = "SupplierDebitNote_active_supplier_reference_key";
  /** A DN of the same supplier committed earlier; heads[0] stays the DN under test. */
  const otherDebit = (overrides: Partial<MoneyRow> = {}): MoneyRow => ({ id: "dn-old", debitNo: "SDN26080001", status: "ACTIVE",
    netAmount: 100, amountRemain: 100, supplierId: "supplier", supplierReferenceNo: "DN-001", updatedAt: new Date(CLOCK_BASE), ...overrides });
  const isConflict = (debitNo: string | null) => (error: unknown): boolean =>
    error instanceof service.SupplierDebitReferenceConflictError && (error.existing?.debitNo ?? null) === debitNo &&
    (debitNo === null || error.message.includes(debitNo));
  const assertNoCreate = (): void => {
    assert.equal(store.heads.length, 0); assert.equal(store.lines.length, 0); assert.equal(store.stockWrites, 0);
    assert.deepEqual(store.audits, []); assert.equal(store.notifications, 0);
  };

  it("normalizeSupplierReferenceKey mirrors upper(regexp_replace(ref, '[ \\t./-]', '', 'g'))", () => {
    const cases: Array<[string, string]> = [
      ["DN-001", "DN001"], ["dn 001", "DN001"], ["DN/001", "DN001"], ["dN.0/0-1", "DN001"],
      ["  dn-001  ", "DN001"], ["\tDN\t001\t", "DN001"], ["DN--//..  \t001", "DN001"], ["Inv-2026/09.abc", "INV202609ABC"],
      // Thai has no case: only the five separators go.
      ["ใบเพิ่มหนี้ 12/2569", "ใบเพิ่มหนี้122569"], ["dn-ที่ 5.1", "DNที่51"],
      // Neither side removes any other character.
      ["DN\n001", "DN\n001"], ["DN\u00A0001", "DN\u00A0001"], ["DN_001", "DN_001"], ["DN\\001", "DN\\001"], ["DN,001", "DN,001"],
      ["", ""], [" -./\t", ""],
    ];
    for (const [raw, key] of cases) assert.equal(service.normalizeSupplierReferenceKey(raw), key, JSON.stringify(raw));
  });

  it("the same number is reused after the earlier DN is cancelled", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await service.cancelSupplierDebitNote("dn", "wrong purchase", { userId: "actor" });
    const reused = await service.postSupplierDebitNote({ ...input(), supplierReferenceNo: "sup dn 1" }, { userId: "actor" });
    assert.equal(reused.debitNo, "SDN26090001");
    assert.deepEqual(store.heads.map((head) => [head.status, head.supplierReferenceNo]), [["CANCELLED", "SUP-DN-1"], ["ACTIVE", "sup dn 1"]]);
    assert.deepEqual(store.audits, ["CREATE", "CANCEL", "CREATE"]);
    assert.deepEqual(referenceQueries, [{ supplierId: "supplier", status: "ACTIVE" }, { supplierId: "supplier", status: "ACTIVE" }]);
  });

  it("a cancelled DN or another supplier's ACTIVE DN with the same number does not block a create", async () => {
    store.others = [otherDebit({ status: "CANCELLED", supplierReferenceNo: "SUP-DN-1" }),
      otherDebit({ id: "dn-other-supplier", debitNo: "SDN26080002", supplierId: "supplier-2", supplierReferenceNo: "SUP-DN-1" })];
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    assert.equal(store.heads.length, 1); assert.deepEqual(store.audits, ["CREATE"]);
  });

  for (const spelling of ["dn 001", "DN/001", "Dn.001", " dn-0-0-1 "]) {
    it(`create with "${spelling}" is rejected before any write when ACTIVE "DN-001" exists, naming that DN`, async () => {
      store.others = [otherDebit()];
      await assert.rejects(service.postSupplierDebitNote({ ...input(), supplierReferenceNo: spelling }, { userId: "actor" }),
        isConflict("SDN26080001"));
      assertNoCreate(); assert.equal(docNumberCalls, 0, "rejected before a DN number is issued");
    });
  }

  it("the rejection message names the ACTIVE DN and explains the reuse rule in Thai", async () => {
    store.others = [otherDebit()];
    await assert.rejects(service.postSupplierDebitNote({ ...input(), supplierReferenceNo: "dn 001" }, { userId: "actor" }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "เลข DN ของซัพพลายเออร์ซ้ำกับ SDN26080001 (เลขของซัพพลายเออร์ DN-001) ที่ยังใช้งานอยู่ · " +
        "เลขที่ต่างกันเพียงตัวพิมพ์เล็ก-ใหญ่ เว้นวรรค จุด / หรือ - ถือเป็นเลขเดียวกัน · ใช้เลขซ้ำได้เมื่อยกเลิก DN เดิมแล้วเท่านั้น");
      return true;
    });
  });

  it("a header edit to a number an ACTIVE DN holds is rejected before any write; with a line change, before any reversal", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    store.others = [otherDebit()];
    events = [];
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), supplierReferenceNo: "dn/001" }, { userId: "actor" }),
      isConflict("SDN26080001"));
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), supplierReferenceNo: "DN 001",
      expectedInventoryAmount: 120, expectedVarianceAmount: 180, items: [{ ...input().items[0], increaseAmount: 30 }] }, { userId: "actor" }),
    isConflict("SDN26080001"));
    assert.equal(store.heads[0].supplierReferenceNo, "SUP-DN-1"); assert.equal(store.heads[0].netAmount, 500);
    assert.deepEqual(events, []); assert.deepEqual(store.audits, ["CREATE"]); assert.equal(store.notifications, 1);
    assert.deepEqual(referenceQueries.at(-1), { supplierId: "supplier", status: "ACTIVE", id: { not: "dn" } });
  });

  it("a header edit may take a cancelled DN's number, or respell its own number", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    store.others = [otherDebit({ status: "CANCELLED" })];
    await service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), supplierReferenceNo: "dn 001" }, { userId: "actor" });
    assert.equal(store.heads[0].supplierReferenceNo, "dn 001");
    await service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), supplierReferenceNo: "DN-001" }, { userId: "actor" });
    assert.equal(store.heads[0].supplierReferenceNo, "DN-001"); assert.deepEqual(store.audits, ["CREATE", "UPDATE", "UPDATE"]);
  });

  it("an edit that keeps the number runs no duplicate check", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    referenceQueries = [];
    await service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), note: "note only" }, { userId: "actor" });
    assert.deepEqual(referenceQueries, []);
  });

  it("P2002 safety net on create: a concurrent ACTIVE DN is named with the pre-check's message, nothing is kept", async () => {
    concurrentDebit = otherDebit({ id: "dn-race", debitNo: "SDN26090002", supplierReferenceNo: "SUP DN 1" });
    pendingHeaderWriteError = uniqueViolation(ACTIVE_INDEX);
    await assert.rejects(service.postSupplierDebitNote(input(), { userId: "actor" }), (error: unknown) => {
      assert.ok(isConflict("SDN26090002")(error));
      assert.ok(error instanceof Error);
      assert.equal(error.message, service.buildSupplierReferenceConflictMessage(
        { id: "dn-race", debitNo: "SDN26090002", supplierReferenceNo: "SUP DN 1" }));
      return true;
    });
    assertNoCreate();
  });

  it("P2002 safety net on header edit: the concurrent DN is named and the edit is rolled back", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    concurrentDebit = otherDebit({ id: "dn-race", debitNo: "SDN26090002", supplierReferenceNo: "DN-009" });
    pendingHeaderWriteError = uniqueViolation(ACTIVE_INDEX);
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), ...loaded(), supplierReferenceNo: "dn 009" }, { userId: "actor" }),
      isConflict("SDN26090002"));
    assert.equal(store.heads[0].supplierReferenceNo, "SUP-DN-1"); assert.deepEqual(store.audits, ["CREATE"]); assert.equal(store.notifications, 1);
  });

  it("P2002 of the index whose DN is gone by the lookup still gets the Thai message, without a DN number", async () => {
    pendingHeaderWriteError = uniqueViolation(ACTIVE_INDEX);
    await assert.rejects(service.postSupplierDebitNote(input(), { userId: "actor" }), (error: unknown) => {
      assert.ok(isConflict(null)(error));
      assert.ok(error instanceof Error);
      assert.equal(error.message, service.buildSupplierReferenceConflictMessage(null));
      return true;
    });
  });

  it("a P2002 of another unique key is not mistaken for a duplicate supplier number", async () => {
    pendingHeaderWriteError = uniqueViolation("SupplierDebitNote_debitNo_key");
    await assert.rejects(service.postSupplierDebitNote(input(), { userId: "actor" }), (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" &&
      !(error instanceof service.SupplierDebitReferenceConflictError));
    assertNoCreate();
  });

  it("isActiveSupplierReferenceViolation matches only a P2002 naming the T4 index", () => {
    assert.equal(service.SUPPLIER_REFERENCE_ACTIVE_INDEX, ACTIVE_INDEX);
    assert.equal(service.isActiveSupplierReferenceViolation(uniqueViolation(ACTIVE_INDEX)), true);
    assert.equal(service.isActiveSupplierReferenceViolation(new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the constraint: \`${ACTIVE_INDEX}\``, { code: "P2002", clientVersion: "test" })), true);
    assert.equal(service.isActiveSupplierReferenceViolation(uniqueViolation("SupplierDebitNote_supplierId_supplierReferenceNo_key")), false);
    assert.equal(service.isActiveSupplierReferenceViolation(new Prisma.PrismaClientKnownRequestError(
      `Foreign key constraint violated on the constraint: \`${ACTIVE_INDEX}\``, { code: "P2003", clientVersion: "test" })), false);
    assert.equal(service.isActiveSupplierReferenceViolation(new Error(ACTIVE_INDEX)), false);
  });
});
