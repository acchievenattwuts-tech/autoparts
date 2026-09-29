import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { getThailandDateKey, parseDateOnlyToDate } from "@/lib/th-date";

type MoneyRow = { id: string; debitNo: string; status: string; netAmount: number; amountRemain: number; supplierId: string; supplierReferenceNo?: string };
type LineRow = { id: string; debitNoteId: string; productId: string; stockCardId?: string; inventoryAmount: number; varianceAmount: number };
type Store = { heads: MoneyRow[]; lines: LineRow[]; stock: number; average: number; stockWrites: number;
  audits: string[]; notifications: number; factCost: number; paid: number; failAudit: boolean; failFact: boolean; locks: string[] };
const initial = (): Store => ({ heads: [], lines: [], stock: 4, average: 100, stockWrites: 0,
  audits: [], notifications: 0, factCost: 0, paid: 0, failAudit: false, failFact: false, locks: [] });
let store = initial();
const originalPurchase = { id: "purchase", supplierId: "supplier", status: "ACTIVE", amountRemain: 0,
  purchaseDate: parseDateOnlyToDate("2026-01-01"), items: [{ id: "source-line", productId: "sku", quantity: 10,
    unitScale: 1, showUnitName: "piece", showPricePerUnit: 100, costPrice: 100,
    product: { code: "SKU", name: "Golden product" } }] };
const tx = {
  $queryRaw: async (parts: TemplateStringsArray) => { store.locks.push(parts.join("?")); return []; },
  purchase: { findUnique: async () => originalPurchase },
  purchaseItem: { findMany: async () => originalPurchase.items.map((item) => ({ productId: item.productId })) },
  product: { findMany: async () => [{ id: "sku", stock: store.stock, inventoryTracking: "TRACKED" }] },
  stockCard: {
    findFirst: async (args: { where: { docDate?: { gt?: Date } } }) => args.where.docDate?.gt ? null
      : { qtyBalance: store.stock, priceBalance: new Prisma.Decimal(store.average) },
    findUniqueOrThrow: async () => ({ priceBalance: new Prisma.Decimal(store.average) }),
    deleteMany: async () => { store.stockWrites = 0; return { count: 1 }; },
  },
  supplierDebitNote: {
    create: async ({ data }: { data: Omit<MoneyRow, "id" | "status"> }) => {
      const head = { ...data, id: "dn", status: "ACTIVE" }; store.heads.push(head); return head;
    },
    findUnique: async () => store.heads[0] ? { ...store.heads[0], items: store.lines.map((line) => ({ ...line })) } : null,
    findUniqueOrThrow: async () => ({ ...store.heads[0], netAmount: new Prisma.Decimal(store.heads[0].netAmount),
      items: store.lines, supplierPaymentItems: [{ paidAmount: store.paid }] }),
    update: async ({ data }: { data: Partial<MoneyRow> }) => { Object.assign(store.heads[0], data); return store.heads[0]; },
  },
  supplierDebitNoteItem: {
    create: async ({ data }: { data: Omit<LineRow, "id"> }) => { const line = { ...data, id: "dn-line" }; store.lines.push(line); return line; },
    update: async ({ data }: { data: Partial<LineRow> }) => { Object.assign(store.lines[0], data); return store.lines[0]; },
    deleteMany: async () => { const count = store.lines.length; store.lines = []; return { count }; },
  },
  factProfit: { updateMany: async () => { store.factCost = 0; return { count: 1 }; } },
};
let service: typeof import("@/lib/supplier-debit-note");
before(async () => {
  await mock.module("@/lib/db", { namedExports: { dbTx: async (callback: (client: typeof tx) => Promise<unknown>) => {
    const snapshot: Store = { ...store, heads: store.heads.map((head) => ({ ...head })),
      lines: store.lines.map((line) => ({ ...line })), audits: [...store.audits], locks: [...store.locks] };
    try { return await callback(tx); } catch (error) { store = snapshot; throw error; }
  } } });
  await mock.module("@/lib/doc-number", { namedExports: { generateSupplierDebitNo: async () => "SDN26090001" } });
  await mock.module("@/lib/stock-card", { namedExports: {
    getStockValuationEpoch: async () => 0,
    writeStockCard: async (_client: unknown, input: { qtyIn: number; qtyOut: number; valueAdjustment: number; costVariance: number }) => {
      assert.equal(input.qtyIn, 0); assert.equal(input.qtyOut, 0);
      store.stockWrites += 1;
      if (store.stock > 0) store.average += input.valueAdjustment / store.stock;
      return "stock-dn";
    },
    recalculateStockCardMany: async () => { store.average = 100; },
  } });
  await mock.module("@/lib/profit-fact", { namedExports: { rebuildSupplierDebitProfitFacts: async () => {
    if (store.failFact) throw new Error("fact failure");
    store.factCost = store.lines.reduce((total, line) => total + line.varianceAmount, 0);
  } } });
  await mock.module("@/lib/audit-log", { namedExports: { writeAuditLogTx: async (_client: unknown, entry: { action: string }) => {
    if (store.failAudit) throw new Error("audit failure"); store.audits.push(entry.action);
  } } });
  await mock.module("@/lib/notifications", { namedExports: { notifySupplierDebitNote: async () => { store.notifications += 1; } } });
  await mock.module("@/lib/profit-cache", { namedExports: { revalidateProfitDashboardCache: () => undefined } });
  await mock.module("@/lib/document-mutation-guard", { namedExports: {
    createDocumentMutationGuard: () => ({ check: async () => ({ reason: store.paid > 0 ? "paid DN blocked" : null }) }),
    buildMutationBlockMessage: (result: { reason: string | null }) => result.reason,
  } });
  service = await import("@/lib/supplier-debit-note");
});
beforeEach(() => { store = initial(); });
const input = () => ({ purchaseId: "purchase", supplierReferenceNo: "SUP-DN-1", debitDate: getThailandDateKey(),
  receivedDate: getThailandDateKey(), dueDate: getThailandDateKey(), reason: "price correction", note: "",
  vatType: "NO_VAT", vatRate: 0, vatRecoverable: true, expectedInventoryAmount: 200, expectedVarianceAmount: 300,
  items: [{ purchaseItemId: "source-line", amountMode: "PER_UNIT", increaseAmount: 50, affectedQuantity: 10 }] });

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
    assert.equal(originalPurchase.items[0].costPrice, 100);
    assert.equal(store.heads[0].amountRemain, 500);
    assert.equal(store.factCost, 300);
    assert.equal(store.stock, 4); assert.equal(store.average, 150);
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
  it("stale preview after a concurrent stock change rejects before writes", async () => {
    store.stock = 3;
    await assert.rejects(service.postSupplierDebitNote(input(), { userId: "actor" }), /ยอดจัดสรรต้นทุนเปลี่ยน/);
    assert.equal(store.heads.length, 0); assert.equal(store.stockWrites, 0); assert.equal(store.notifications, 0);
  });
  it("zero stock recognizes 500 variance without carrying inventory value", async () => {
    store.stock = 0;
    await service.postSupplierDebitNote({ ...input(), expectedInventoryAmount: 0, expectedVarianceAmount: 500 }, { userId: "actor" });
    assert.equal(store.stock, 0); assert.equal(store.factCost, 500); assert.equal(store.heads[0].amountRemain, 500);
  });
  for (const failure of ["failAudit", "failFact"] as const) {
    it(`${failure} rolls back header/items/stock/profit and sends no notification`, async () => {
      store[failure] = true;
      await assert.rejects(service.postSupplierDebitNote(input(), { userId: "actor" }), /failure/);
      assert.equal(store.heads.length, 0); assert.equal(store.lines.length, 0);
      assert.equal(store.average, 100); assert.equal(store.stockWrites, 0); assert.equal(store.notifications, 0);
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
    assert.equal(store.average, 150); assert.deepEqual(store.audits, ["CREATE"]); assert.equal(store.notifications, 1);
  });
  it("unpaid last DN cancellation restores cost and clears AP/current cost", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await service.cancelSupplierDebitNote("dn", "cancel", { userId: "actor" });
    assert.equal(store.heads[0].status, "CANCELLED"); assert.equal(store.heads[0].amountRemain, 0);
    assert.equal(store.factCost, 0); assert.equal(store.average, 100);
    assert.deepEqual(store.audits, ["CREATE", "CANCEL"]); assert.equal(store.notifications, 2);
  });
  it("header-only edit keeps stock, AP and cost untouched even after payment", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" }); store.paid = 100;
    const result = await service.updateSupplierDebitNote("dn", { ...input(), supplierReferenceNo: "SUP-DN-1A", note: "corrected ref",
      expectedInventoryAmount: undefined, expectedVarianceAmount: undefined }, { userId: "actor" });
    assert.deepEqual(result, { id: "dn", debitNo: "SDN26090001", reposted: false });
    assert.equal(store.heads[0].supplierReferenceNo, "SUP-DN-1A");
    assert.equal(store.average, 150); assert.equal(store.factCost, 300); assert.equal(store.heads[0].amountRemain, 500);
    assert.deepEqual(store.audits, ["CREATE", "UPDATE"]); assert.equal(store.notifications, 2);
  });
  it("line edit reverses the posted value and reposts under the same DN number", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    const edited = { ...input(), expectedInventoryAmount: 120, expectedVarianceAmount: 180,
      items: [{ ...input().items[0], increaseAmount: 30 }] };
    const result = await service.updateSupplierDebitNote("dn", edited, { userId: "actor" });
    assert.deepEqual(result, { id: "dn", debitNo: "SDN26090001", reposted: true });
    assert.equal(store.heads[0].netAmount, 300); assert.equal(store.heads[0].amountRemain, 300);
    assert.equal(store.lines.length, 1); assert.equal(store.average, 130); assert.equal(store.factCost, 180);
    assert.deepEqual(store.audits, ["CREATE", "UPDATE"]); assert.equal(store.notifications, 2);
  });
  it("line edit on a paid DN is blocked with no reversal side effects", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" }); store.paid = 100;
    const edited = { ...input(), expectedInventoryAmount: 120, expectedVarianceAmount: 180, items: [{ ...input().items[0], increaseAmount: 30 }] };
    await assert.rejects(service.updateSupplierDebitNote("dn", edited, { userId: "actor" }), /paid DN blocked/);
    assert.equal(store.heads[0].netAmount, 500); assert.equal(store.lines.length, 1);
    assert.equal(store.average, 150); assert.equal(store.factCost, 300); assert.deepEqual(store.audits, ["CREATE"]);
  });
  it("line edit without a fresh preview and a changed source purchase are both rejected", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), items: [{ ...input().items[0], increaseAmount: 30 }] }, { userId: "actor" }), /ตรวจยอด/);
    await assert.rejects(service.updateSupplierDebitNote("dn", { ...input(), purchaseId: "other" }, { userId: "actor" }), /เปลี่ยนใบซื้อ/);
    assert.equal(store.heads[0].netAmount, 500); assert.equal(store.average, 150); assert.deepEqual(store.audits, ["CREATE"]);
  });
  it("cancelled DN cannot be edited", async () => {
    await service.postSupplierDebitNote(input(), { userId: "actor" });
    await service.cancelSupplierDebitNote("dn", "cancel", { userId: "actor" });
    await assert.rejects(service.updateSupplierDebitNote("dn", input(), { userId: "actor" }), /เฉพาะ DN ที่ใช้งาน/);
  });
});
