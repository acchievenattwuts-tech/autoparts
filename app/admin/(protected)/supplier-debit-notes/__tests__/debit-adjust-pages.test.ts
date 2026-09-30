import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

/** SSR of the "ปรับยอด DN" pages (R5-D / ก3): the adjust form, and the parent/adjustment detail pages, in light + dark. */
const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const posted = parseDateOnlyToDate("2026-08-15");
const today = parseDateOnlyToDate("2026-09-30");
const line = { id: "line-1", lineNo: 1, purchaseItemId: "pi-1", productId: "sku", affectedQuantity: D(10), increaseAmount: D(50),
  amountMode: "PER_UNIT", showUnitName: "ชิ้น", originalUnitPrice: D(100), netAmount: D(500), inventoryAmount: D(200),
  varianceAmount: D(300), avgCostBefore: D(100), avgCostAfter: D(150), product: { code: "SKU", name: "Brake pad" } };
const common = { supplierId: "sup-1", purchaseId: "po-1", supplier: { name: "Supplier A" }, purchase: { id: "po-1", purchaseNo: "PU26080001" },
  user: { name: "Owner" }, vatType: "NO_VAT", vatRate: D(0), vatRecoverable: false, vatAmount: D(0), subtotalAmount: D(0), note: "",
  cancelledAt: null, cancelNote: null, createdAt: today, updatedAt: today, debitDate: today, receivedDate: today, dueDate: today,
  reason: "ราคาปรับ", supplierPaymentItems: [] };
const rows: Record<string, Record<string, unknown>> = {
  dn: { ...common, id: "dn", debitNo: "SDN26080001", supplierReferenceNo: "SUP-DN-1", status: "ACTIVE", adjustsDebitNoteId: null,
    adjustsDebitNote: null, postingDate: posted, netAmount: D(500), amountRemain: D(300), inventoryAmount: D(200), varianceAmount: D(300),
    excessSettlementType: null, cashBankAccount: null, items: [line],
    adjustments: [{ id: "adj-1", debitNo: "SDN26090002", status: "ACTIVE", postingDate: today, netAmount: D(-200), amountRemain: D(0),
      items: [{ purchaseItemId: "pi-1", netAmount: D(-200) }] }] },
  "adj-1": { ...common, id: "adj-1", debitNo: "SDN26090002", supplierReferenceNo: "SUP-CN-1", status: "ACTIVE", adjustsDebitNoteId: "dn",
    adjustsDebitNote: { id: "dn", debitNo: "SDN26080001" }, postingDate: today, netAmount: D(-200), amountRemain: D(0),
    inventoryAmount: D(-80), varianceAmount: D(-120), excessSettlementType: "CASH_REFUND", cashBankAccount: { name: "KBank" },
    items: [{ ...line, increaseAmount: D(-200), amountMode: "TOTAL", netAmount: D(-200), inventoryAmount: D(-80), varianceAmount: D(-120) }],
    adjustments: [] },
};

before(async () => {
  const realDb = await import("@/lib/db");
  const db = {
    supplierDebitNote: { findUnique: async ({ where }: { where: { id: string } }) => rows[where.id] ?? null },
    documentPayment: { findMany: async () => [{ amount: D(200) }] },
    profitDistribution: { findFirst: async () => null, findMany: async () => [] },
    $executeRaw: async () => 0,
  };
  await mock.module("@/lib/db", { namedExports: { ...realDb, db, dbTx: async (callback: (client: typeof db) => Promise<unknown>) => callback(db) } });
  const realAuth = await import("@/lib/require-auth");
  const permissions = ["supplier_debit_notes.view", "supplier_debit_notes.create", "supplier_debit_notes.update", "supplier_debit_notes.cancel"];
  await mock.module("@/lib/require-auth", { namedExports: { ...realAuth,
    requirePermission: async () => ({ user: { id: "user-1", permissions } }),
    getSessionPermissionContext: async () => ({ role: "STAFF", permissions }),
  } });
  const realGuard = await import("@/lib/document-mutation-guard");
  await mock.module("@/lib/document-mutation-guard", { namedExports: { ...realGuard,
    createDocumentMutationGuard: () => ({ check: async () => ({ blocked: false, reason: null, references: [] }) }),
  } });
  const realActivity = await import("@/lib/document-activity");
  await mock.module("@/lib/document-activity", { namedExports: { ...realActivity, getDocumentActivityTimeline: async () => [] } });
  await mock.module("@/lib/cash-bank-accounts", { namedExports: { getActiveCashBankAccountOptions: async () => [
    { id: "acc-bank", name: "KBank", code: "B01", type: "BANK", bankName: "กสิกร", accountNo: "123" }] } });
  const realNavigation = await import("next/navigation");
  await mock.module("next/navigation", { namedExports: { ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  } });
});

const renderAdjust = async (id: string): Promise<string> => {
  const { default: Page } = await import("../[id]/adjust/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) }));
};
const renderDetail = async (id: string): Promise<string> => {
  const { default: Page } = await import("../[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
};

describe("ปรับยอด DN pages", () => {
  it("the adjust form shows the parent's lines with what is still charged after earlier adjustments (500 - 200 = 300)", async () => {
    const html = await renderAdjust("dn");
    assert.match(html, /ปรับยอด DN <span class="font-mono">SDN26080001<\/span>/);
    for (const text of ["ลดยอด", "เพิ่มยอด", "ยอด DN คงเหลือ", "Brake pad", "ตรวจยอด", "ยืนยันปรับยอด DN"]) assert.ok(html.includes(text), text);
    assert.match(html, />300\.00</);
    assert.match(html, /dark:bg-\[#101b2e\]/);
    // V3: VAT type, rate and recoverability come from the parent and cannot be changed here.
    assert.match(html, /ใช้ VAT ตาม DN ต้นทาง SDN26080001 \(แก้ไม่ได้\) · ไม่มี VAT แยก: ยอดทั้งหมดเป็นต้นทุน/);
    assert.match(html, /<select[^>]*disabled=""/);
  });

  it("an adjustment cannot itself be adjusted", async () => {
    const html = await renderAdjust("adj-1");
    assert.match(html, /เอกสารนี้เป็นเอกสารปรับยอด DN แล้ว/);
    assert.doesNotMatch(html, /ยืนยันปรับยอด DN/);
  });

  it("the parent detail page offers ปรับยอด DN and lists its adjustments with the adjusted total", async () => {
    const html = await renderDetail("dn");
    assert.ok(html.includes('href="/admin/supplier-debit-notes/dn/adjust"'));
    assert.ok(html.includes('href="/admin/supplier-debit-notes/adj-1"'));
    assert.match(html, /ยอด DN หลังปรับ[^]*300\.00/);
  });

  it("the adjustment detail page links its parent, hides edit/adjust, and explains the refund", async () => {
    const html = await renderDetail("adj-1");
    assert.match(html, /ปรับยอดจาก DN SDN26080001/);
    assert.ok(html.includes('href="/admin/supplier-debit-notes/dn"'));
    assert.doesNotMatch(html, /adj-1\/edit|adj-1\/adjust/);
    assert.match(html, /ซัพพลายเออร์คืนเงินเข้าบัญชี KBank/);
    assert.match(html, /เครดิตคงเหลือ/);
    assert.match(html, /dark:bg-teal-500\/10/);
  });
});
