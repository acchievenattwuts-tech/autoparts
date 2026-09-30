import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";

// V8 (W4): a PURCHASE_ALLOWANCE row shows as "ลดราคาซื้อ" with quantity 0, its (negative) stock value change and
// variance, and links to its purchase return for users who may view purchase returns (light + dark classes).

const mockUnavailable = typeof (mock as { module?: unknown }).module !== "function"
  && "requires --experimental-test-module-mocks";
let canViewReturns = true;
const DOC_NO = "PR26093000001";
const returnLookups: unknown[] = [];

before(async () => {
  if (mockUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", { namedExports: { ...realDb, db: {
    product: { findUnique: async () => ({ id: "product-1", code: "P1", name: "Part", stock: 4, avgCost: 80,
      reportUnitName: null, units: [{ name: "piece", scale: 1, isBase: true }] }) },
    stockCard: { findMany: async () => [{ id: "card-pa", docDate: new Date("2026-09-30T00:00:00+07:00"), docNo: DOC_NO,
      source: "PURCHASE_ALLOWANCE", detail: "ลดราคาซื้อ · มูลค่าสต็อก -80.00 / ส่วนต่างต้นทุน -120.00", qtyIn: 0, qtyOut: 0,
      qtyBalance: 4, priceIn: 0, priceBalance: 80, valueAdjustment: -80, costVariance: -120 }] },
    supplierDebitNote: { findMany: async () => { throw new Error("no DN lookup for a purchase allowance row"); } },
    purchaseReturn: { findMany: async (args: unknown) => { returnLookups.push(args); return [{ id: "return-1", returnNo: DOC_NO }]; } },
  } } });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", { namedExports: { ...realAuth,
    requirePermission: async () => undefined,
    getSessionPermissionContext: async () => ({ role: "STAFF", permissions: ["stock.card.view",
      ...(canViewReturns ? ["purchase_returns.view"] : [])] }),
  } });
  await mock.module("@/components/shared/AdminSearchForm", { defaultExport:
    ({ children, className }: { children: ReactNode; className?: string }) => createElement("form", { className }, children) });
  await mock.module("@/components/shared/AdminSearchSubmitButton", { defaultExport:
    ({ children }: { children: ReactNode }) => createElement("button", {}, children) });
});

const render = async (): Promise<{ html: string; row: string }> => {
  const { default: Page } = await import("../page");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ productId: "product-1" }) }));
  const index = html.indexOf(DOC_NO);
  assert.ok(index >= 0);
  return { html, row: html.slice(html.lastIndexOf("<tr", index), html.indexOf("</tr>", index)) };
};

test("a ลดราคาซื้อ row shows quantity 0, -80 stock value, -120 variance and links its purchase return", { skip: mockUnavailable }, async () => {
  canViewReturns = true;
  returnLookups.length = 0;
  const { html, row } = await render();
  assert.match(row, />ลดราคาซื้อ</);
  assert.equal((row.match(/>0<\/td>/g) ?? []).length, 2);
  assert.match(row, />-80\.00<\/td>/);
  assert.match(row, />-120\.00<\/td>/);
  assert.match(row, /href="\/admin\/purchase-returns\/return-1"/);
  assert.equal((row.match(/<td /g) ?? []).length, 14);
  assert.match(row, /dark:text-cyan-300/);
  assert.match(html, /ไม่เปลี่ยนจำนวนสินค้า/);
  assert.match(html, /dark:bg-cyan-950/);
  assert.doesNotMatch(html, /ผลต่างมูลค่าสต็อก:/, "a posted allowance variance is not a T3 residual");
  assert.deepEqual(returnLookups, [{ where: { returnNo: { in: [DOC_NO] } }, select: { id: true, returnNo: true } }]);
});

test("without purchase-return permission the amounts show without a link and nothing is looked up", { skip: mockUnavailable }, async () => {
  canViewReturns = false;
  returnLookups.length = 0;
  const { row } = await render();
  assert.match(row, />-80\.00<\/td>/);
  assert.doesNotMatch(row, /href="\/admin\/purchase-returns/);
  assert.deepEqual(returnLookups, []);
});
