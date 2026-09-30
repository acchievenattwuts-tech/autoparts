import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

/** SSR of the DN edit and detail pages for review round 3: cleared source links (R1) and header date locks (R4). */
const DOC_NO = "SDN26090001";
type DebitLine = ReturnType<typeof line>;
const line = (purchaseItemId: string | null, lineNo = 1) => ({ id: `line-${lineNo}`, lineNo, purchaseItemId, productId: `product-${lineNo}`,
  affectedQuantity: 10, increaseAmount: 50, amountMode: "PER_UNIT", showUnitName: "กล่อง", originalUnitPrice: 123.45,
  inventoryAmount: 200, varianceAmount: 300, avgCostBefore: 100, avgCostAfter: 150,
  product: { code: `P${lineNo}`, name: `Part ${lineNo}` } });
type DebitVat = { vatType?: string; vatRate?: number; vatRecoverable?: boolean };
const debitRow = (overrides: { status?: string; amountRemain?: number; items?: DebitLine[] } & DebitVat) => ({
  id: "dn", debitNo: DOC_NO, supplierReferenceNo: "SUP-DN-1", status: overrides.status ?? "ACTIVE",
  debitDate: parseDateOnlyToDate("2026-09-27"), receivedDate: parseDateOnlyToDate("2026-09-28"),
  postingDate: parseDateOnlyToDate("2026-09-29"), dueDate: parseDateOnlyToDate("2026-10-29"),
  reason: "ซัพพลายเออร์ปรับราคา", note: "", vatType: overrides.vatType ?? "NO_VAT",
  vatRate: new Prisma.Decimal(overrides.vatRate ?? 0), vatRecoverable: overrides.vatRecoverable ?? false,
  subtotalAmount: 500, vatAmount: 0, netAmount: 500, inventoryAmount: 200, varianceAmount: 300,
  amountRemain: new Prisma.Decimal(overrides.amountRemain ?? 500),
  cancelledAt: null, cancelNote: overrides.status === "CANCELLED" ? "ยกเลิกทดสอบ" : null,
  createdAt: new Date("2026-09-29T03:00:00.000Z"), updatedAt: new Date("2026-09-29T03:00:00.000Z"),
  supplier: { name: "Supplier A" }, user: { name: "Admin" }, supplierPaymentItems: [],
  purchase: { id: "po", purchaseNo: "PO26090001", vatType: "NO_VAT", vatRate: 0, supplier: { name: "Supplier A" },
    items: [{ id: "pi-1", quantity: 10, showQty: null, showUnitName: "กล่อง", showPricePerUnit: 123.45, costPrice: 123.45,
      product: { code: "P1", name: "Part 1" } }] },
  items: overrides.items ?? [line("pi-1")],
});

let current = debitRow({});
let declaredNo: string | null = null;
/** The vat_registered_from setting (lib/input-vat.ts); null while the shop is not VAT-registered. */
let registeredFrom: string | null = null;
let periodQueries: unknown[] = [];
let service: typeof import("@/lib/supplier-debit-note");

before(async () => {
  const realDb = await import("@/lib/db");
  // The header locks read the shared month lock (lib/period-lock.ts) in a short transaction.
  const tx = {
    $executeRaw: async () => 0,
    siteContent: { findUnique: async () => (registeredFrom ? { value: registeredFrom } : null) },
    supplierDebitNote: { findUnique: async () => current },
    profitDistribution: {
      findMany: async (args: { where: { activePeriodKey: { in: string[] } } }) => {
        periodQueries.push(args);
        return declaredNo ? args.where.activePeriodKey.in.map((activePeriodKey) => ({ activePeriodKey, distributionNo: declaredNo })) : [];
      },
      findFirst: async () => (declaredNo ? { id: "pd" } : null),
    },
  };
  await mock.module("@/lib/db", { namedExports: { ...realDb, db: tx,
    dbTx: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", { namedExports: { ...realAuth,
    requirePermission: async () => ({ user: { id: "user-1" } }),
    getSessionPermissionContext: async () => ({ role: "STAFF",
      permissions: ["supplier_debit_notes.view", "supplier_debit_notes.update", "supplier_debit_notes.cancel"] }),
  } });
  const realGuard = await import("@/lib/document-mutation-guard");
  await mock.module("@/lib/document-mutation-guard", { namedExports: { ...realGuard,
    createDocumentMutationGuard: () => ({ check: async () => ({ blocked: false, reason: null, references: [] }) }),
  } });
  const realActivity = await import("@/lib/document-activity");
  await mock.module("@/lib/document-activity", { namedExports: { ...realActivity, getDocumentActivityTimeline: async () => [] } });
  const realNavigation = await import("next/navigation");
  await mock.module("next/navigation", { namedExports: { ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  } });
  service = await import("@/lib/supplier-debit-note");
});

beforeEach(() => { current = debitRow({}); declaredNo = null; periodQueries = []; registeredFrom = null; });

const renderEdit = async (): Promise<string> => {
  const { default: EditPage } = await import("../[id]/edit/page");
  return renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: "dn" }) }));
};
const renderDetail = async (): Promise<string> => {
  const { default: DetailPage } = await import("../[id]/page");
  const page: ReactElement = await DetailPage({ params: Promise.resolve({ id: "dn" }), searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(page);
};
/** The rendered <input> whose value attribute is exactly `value`. */
const inputWithValue = (html: string, value: string): string => {
  const tag = html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0];
  assert.ok(tag, `input with value ${value}`);
  return tag;
};
const isDisabled = (html: string, value: string): boolean => /\sdisabled=""/.test(inputWithValue(html, value));
const DEBIT_DATE = "2026-09-27";
const RECEIVED_DATE = "2026-09-28";
const DUE_DATE = "2026-10-29";

describe("supplier DN edit page: VAT treatment note (V1)", () => {
  it("not registered: VAT excl. 7% is cost, in light and dark styles", async () => {
    current = debitRow({ vatType: "EXCLUDING_VAT", vatRate: 7 });
    const html = await renderEdit();
    assert.ok(html.includes("ร้านยังไม่ได้จดทะเบียน VAT: VAT รวมเป็นต้นทุนทั้งจำนวน"));
    assert.doesNotMatch(html, /ร้านไม่ได้จดทะเบียน VAT: VAT ของ DN/);
    assert.match(html, /bg-sky-50[^"]*dark:bg-sky-500\/10/);
  });

  it("registered before the DN date: input tax for a recoverable DN, no stored-decision note", async () => {
    registeredFrom = "2026-09-01";
    current = debitRow({ vatType: "EXCLUDING_VAT", vatRate: 7, vatRecoverable: true });
    const html = await renderEdit();
    assert.match(html, /ร้านจดทะเบียน VAT แล้ว \(ตั้งแต่ [^)]+\): VAT เป็นภาษีซื้อ ไม่รวมในต้นทุน/);
    assert.doesNotMatch(html, /DN นี้บันทึกไว้แล้วว่า/);
  });

  it("a DN stored as cost before the shop registered says the stored decision is kept until lines, VAT or DN date change", async () => {
    registeredFrom = "2026-09-01";
    current = debitRow({ vatType: "EXCLUDING_VAT", vatRate: 7, vatRecoverable: false });
    const html = await renderEdit();
    assert.ok(html.includes("DN นี้บันทึกไว้แล้วว่า VAT รวมในต้นทุน · คงไว้จนกว่าจะแก้รายการ VAT หรือวันที่ออก DN"));
  });

  it("registered after the DN date: the VAT stays cost", async () => {
    registeredFrom = "2026-09-28";
    current = debitRow({ vatType: "INCLUDING_VAT", vatRate: 7 });
    assert.match(await renderEdit(), /วันที่ใบกำกับภาษีก่อนวันจดทะเบียน VAT/);
  });
});

describe("supplier DN edit page: header date locks share the server's reasons (R4)", () => {
  it("an open DN in an undeclared month keeps every header field editable", async () => {
    const html = await renderEdit();
    for (const value of [DEBIT_DATE, RECEIVED_DATE, DUE_DATE, "SUP-DN-1", "ซัพพลายเออร์ปรับราคา"]) assert.equal(isDisabled(html, value), false, value);
    assert.doesNotMatch(html, /ไม่ได้:/);
    assert.deepEqual(periodQueries, [{ where: { activePeriodKey: { in: ["2026-09"] }, status: "ACTIVE" },
      select: { activePeriodKey: true, distributionNo: true } }]);
  });

  it("a declared posting month disables the debit and received dates only, with the shared period reason", async () => {
    declaredNo = "PD26100001";
    const html = await renderEdit();
    const locks = service.getSupplierDebitHeaderLocks({ amountRemain: 500,
      declaredPeriod: { label: "กันยายน 2026", distributionNo: "PD26100001" } });
    assert.ok(locks.debitDate && locks.receivedDate);
    assert.equal(isDisabled(html, DEBIT_DATE), true); assert.equal(isDisabled(html, RECEIVED_DATE), true);
    assert.equal(isDisabled(html, DUE_DATE), false); assert.equal(isDisabled(html, "SUP-DN-1"), false);
    assert.ok(html.includes(locks.debitDate)); assert.ok(html.includes(locks.receivedDate));
    assert.doesNotMatch(html, /แก้ไขวันครบกำหนดชำระไม่ได้/);
  });

  it("a fully paid DN disables all three dates with the shared paid reason in light and dark styles", async () => {
    current = debitRow({ amountRemain: 0 });
    const html = await renderEdit();
    const locks = service.getSupplierDebitHeaderLocks({ amountRemain: 0, declaredPeriod: null });
    for (const value of [DEBIT_DATE, RECEIVED_DATE, DUE_DATE]) assert.equal(isDisabled(html, value), true, value);
    for (const reason of [locks.debitDate, locks.receivedDate, locks.dueDate]) assert.ok(reason && html.includes(reason), String(reason));
    assert.equal(isDisabled(html, "SUP-DN-1"), false, "supplier reference stays editable after payment");
    assert.equal(isDisabled(html, "ซัพพลายเออร์ปรับราคา"), false, "reason stays editable after payment");
    assert.match(html, /text-amber-700 dark:text-amber-300/);
    assert.deepEqual(periodQueries, [], "a settled DN needs no period read");
  });
});

describe("supplier DN pages with a cleared source-line link (R1)", () => {
  it("an ACTIVE DN whose link was cleared shows the Thai reason instead of the form", async () => {
    current = debitRow({ items: [line(null)] });
    const html = await renderEdit();
    assert.ok(html.includes(service.SUPPLIER_DEBIT_UNLINKED_EDIT_MESSAGE));
    assert.doesNotMatch(html, /type="date"/);
    assert.match(html, /dark:bg-amber-500\/10/);
  });

  it("a CANCELLED DN with a cleared link renders the cancelled notice on the edit page", async () => {
    current = debitRow({ status: "CANCELLED", amountRemain: 0, items: [line(null)] });
    const html = await renderEdit();
    assert.match(html, /เอกสารนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้/);
    assert.equal(html.includes(service.SUPPLIER_DEBIT_UNLINKED_EDIT_MESSAGE), false);
  });

  it("the detail page shows the stored product, unit and original price with a note only on the cleared line", async () => {
    current = debitRow({ status: "CANCELLED", amountRemain: 0, items: [line(null, 1), line("pi-2", 2)] });
    const html = await renderDetail();
    assert.equal(html.split(service.SUPPLIER_DEBIT_UNLINKED_LINE_NOTE).length - 1, 1);
    const clearedRow = html.slice(html.indexOf("Part 1"), html.indexOf("Part 2"));
    assert.ok(clearedRow.includes(service.SUPPLIER_DEBIT_UNLINKED_LINE_NOTE));
    assert.match(clearedRow, /10 กล่อง/); assert.match(clearedRow, /123\.45/);
    assert.match(clearedRow, /bg-amber-50[^"]*dark:bg-amber-500\/10[^"]*dark:text-amber-300/);
  });
});
