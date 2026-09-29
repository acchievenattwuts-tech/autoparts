import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";

const mockUnavailable = typeof (mock as { module?: unknown }).module !== "function"
  && "requires --experimental-test-module-mocks";
let canViewDebit = true;
let stock = 4;
let inventory = 200;
let variance = 300;
const DOC_NO = "SDN26090001";

before(async () => {
  if (mockUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", { namedExports: { ...realDb, db: {
    product: { findUnique: async () => ({ id: "product-1", code: "P1", name: "Part", stock,
      avgCost: stock > 0 ? 150 : 100, reportUnitName: null,
      units: [{ name: "piece", scale: 1, isBase: true }] }) },
    stockCard: { findMany: async () => [{ id: "card-dn", docDate: new Date("2026-09-29T00:00:00+07:00"),
      docNo: DOC_NO, source: "SUPPLIER_DEBIT", detail: "Price increase", qtyIn: 0, qtyOut: 0,
      qtyBalance: stock, priceIn: 0, priceBalance: stock > 0 ? 150 : 100,
      valueAdjustment: inventory, costVariance: variance }] },
    supplierDebitNote: { findMany: async () => [{ id: "debit-1", debitNo: DOC_NO }] },
  } } });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", { namedExports: { ...realAuth,
    requirePermission: async () => undefined,
    getSessionPermissionContext: async () => ({ role: "STAFF", permissions: ["stock.card.view",
      ...(canViewDebit ? ["supplier_debit_notes.view"] : [])] }),
  } });
  await mock.module("@/components/shared/AdminSearchForm", { defaultExport:
    ({ children, className }: { children: ReactNode; className?: string }) => createElement("form", { className }, children) });
  await mock.module("@/components/shared/AdminSearchSubmitButton", { defaultExport:
    ({ children }: { children: ReactNode }) => createElement("button", {}, children) });
});

const renderDebit = async (): Promise<{ html: string; row: string }> => {
  const { default: Page } = await import("../page");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ productId: "product-1" }) }));
  const index = html.indexOf(DOC_NO);
  assert.ok(index >= 0);
  return { html, row: html.slice(html.lastIndexOf("<tr", index), html.indexOf("</tr>", index)) };
};

test("partial stock coverage shows DN quantity zero, capitalization, period variance and detail link", { skip: mockUnavailable }, async () => {
  stock = 4; inventory = 200; variance = 300; canViewDebit = true;
  const { row } = await renderDebit();
  assert.match(row, /ใบเพิ่มหนี้ซัพพลายเออร์ \(DN\)/);
  assert.equal((row.match(/>0<\/td>/g) ?? []).length, 2);
  assert.match(row, />200\.00<\/td>/);
  assert.match(row, />300\.00<\/td>/);
  assert.match(row, /href="\/admin\/supplier-debit-notes\/debit-1"/);
  assert.equal((row.match(/<td /g) ?? []).length, 14);
  assert.match(row, /dark:text-indigo-300/);
  assert.match(row, /dark:text-amber-300/);
});

test("zero stock shows zero capitalization and the full DN cost as period variance", { skip: mockUnavailable }, async () => {
  stock = 0; inventory = 0; variance = 500; canViewDebit = true;
  const { row } = await renderDebit();
  assert.match(row, />0\.00<\/td>/);
  assert.match(row, />500\.00<\/td>/);
  assert.equal((row.match(/>0<\/td>/g) ?? []).length, 2);
});

test("stock viewers without DN permission see the amounts and document number without a DN navigation link", { skip: mockUnavailable }, async () => {
  stock = 4; inventory = 200; variance = 300; canViewDebit = false;
  const { row } = await renderDebit();
  assert.match(row, /SDN26090001/);
  assert.match(row, />200\.00<\/td>/);
  assert.doesNotMatch(row, /href="\/admin\/supplier-debit-notes/);
});
