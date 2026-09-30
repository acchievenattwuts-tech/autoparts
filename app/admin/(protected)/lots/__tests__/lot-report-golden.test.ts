import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { resolveReportUnit, toReportUnitQty } from "@/lib/report-unit";
import {
  addThailandDays,
  formatDateThai,
  parseDateOnlyToDate,
  startOfThailandDay,
} from "@/lib/th-date";
import {
  chunkLotKeys,
  compareLotsByExpiry,
  groupLotKeysByProduct,
  lotKeyOf,
  pageSlice,
} from "../lot-report-query";

// These frozen sources are verbatim git HEAD pages before the query changes.
// Both the actual old and current TSX render against identical fixture records.
const ROOT = join(process.cwd(), "app/admin/(protected)/lots");
const FIXED_DAY = "2026-09-29";
const TODAY = parseDateOnlyToDate(FIXED_DAY);
const PAGE_SIZE = 50;
type Key = { productId: string; lotNo: string };
type Product = {
  id: string; name: string; code: string; reportUnitName: string;
  units: { name: string; scale: number; isBase: boolean }[];
};
type Balance = Key & { qtyOnHand: number; product: Product };
type Lot = Key & { expDate: Date | null };
type SaleLot = { lotNo: string; saleItem: { productId: string; sale: { saleDate: Date; status: string } } };
type StringFilter = string | { in: string[] };
type Where = {
  OR?: Where[]; productId?: StringFilter; id?: StringFilter; lotNo?: StringFilter;
  qtyOnHand?: { gt: number }; expDate?: { not: null; lte?: Date };
  saleItem?: { productId?: StringFilter; sale?: { status: { not: string } } };
};
type Query = { where?: Where; take?: number; skip?: number; orderBy?: unknown };
type Fixture = { balances: Balance[]; lots: Lot[]; sales: SaleLot[]; products: Product[] };
type Page = (props: { searchParams: Promise<{ days?: string; page?: string }> }) => Promise<ReactNode>;
type Trace = { saleRowsRead: number; saleOrBranches: number; permissions: string[] };

const product = (id: string): Product => ({
  id, code: `CODE-${id}`, name: `Product ${id}`, reportUnitName: "carton",
  units: [{ name: "piece", scale: 1, isBase: true }, { name: "carton", scale: 10, isBase: false }],
});
const dateAt = (offset: number) => addThailandDays(TODAY, offset);
const stringMatches = (value: string, filter?: StringFilter) =>
  filter === undefined || (typeof filter === "string" ? value === filter : filter.in.includes(value));

function keyMatches(key: Key, where: Where = {}): boolean {
  return stringMatches(key.productId, where.productId)
    && stringMatches(key.lotNo, where.lotNo)
    && (!where.OR || where.OR.some((branch) => keyMatches(key, branch)));
}

function saleMatches(row: SaleLot, where: Where = {}): boolean {
  return stringMatches(row.lotNo, where.lotNo)
    && stringMatches(row.saleItem.productId, where.saleItem?.productId)
    && (!where.saleItem?.sale || row.saleItem.sale.status !== where.saleItem.sale.status.not)
    && (!where.OR || where.OR.some((branch) => saleMatches(row, branch)));
}

function expiryOracle(fixture: Fixture, threshold: Date | undefined) {
  const positive = new Map(fixture.balances.filter((b) => b.qtyOnHand > 0)
    .map((b) => [`${b.productId}:${b.lotNo}`, b.qtyOnHand]));
  return fixture.lots.flatMap((lot) => {
    const qtyOnHand = positive.get(`${lot.productId}:${lot.lotNo}`);
    return lot.expDate && qtyOnHand !== undefined && (!threshold || lot.expDate <= threshold)
      ? [{ ...lot, expDate: lot.expDate, qtyOnHand }] : [];
  }).sort((a, b) => a.expDate.getTime() - b.expDate.getTime()
    || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)
    || (a.lotNo < b.lotNo ? -1 : a.lotNo > b.lotNo ? 1 : 0));
}

function dependencies(fixture: Fixture, trace: Trace): Record<string, unknown> {
  const db = {
    lotBalance: { findMany: async ({ where, take }: Query) => {
      const balances = fixture.balances.filter((b) => !where?.qtyOnHand || b.qtyOnHand > where.qtyOnHand.gt);
      return balances.slice().sort((a, b) => a.productId.localeCompare(b.productId)
        || a.lotNo.localeCompare(b.lotNo)).slice(0, take);
    } },
    productLot: { findMany: async ({ where }: Query) => fixture.lots.filter((lot) =>
      keyMatches(lot, where) && (!where?.expDate || (lot.expDate !== null
        && (!where.expDate.lte || lot.expDate <= where.expDate.lte)))) },
    saleItemLot: { findMany: async ({ where }: Query) => {
      const rows = fixture.sales.filter((row) => saleMatches(row, where));
      trace.saleRowsRead += rows.length;
      trace.saleOrBranches += where?.OR?.length ?? 0;
      return rows;
    } },
    product: { findMany: async ({ where }: Query) => fixture.products.filter((p) => stringMatches(p.id, where?.id)) },
  };
  return {
    "react/jsx-runtime": { jsx, jsxs, Fragment },
    "@/lib/db": { db },
    "@/lib/report-unit": { resolveReportUnit, toReportUnitQty },
    "@/lib/require-auth": { requirePermission: async (permission: string) => { trace.permissions.push(permission); } },
    "@/lib/th-date": { addThailandDays, formatDateThai, parseDateOnlyToDate, startOfThailandDay,
      getThailandDateKey: () => FIXED_DAY },
    "../lot-report-query": { chunkLotKeys, compareLotsByExpiry, groupLotKeysByProduct, lotKeyOf, pageSlice },
    "../lot-expiry-query": { getLotExpiryPage: async (threshold: Date | undefined, page: number, size: number) => {
      // SQL itself is tested separately against PGlite; this tests the page contract.
      const matches = expiryOracle(fixture, threshold);
      return { totalRows: matches.length, lots: matches.slice((page - 1) * size, page * size) };
    } },
    "@/components/shared/Pagination": { __esModule: true, default: (props: {
      currentPage: number; totalPages: number; basePath: string; searchParams: { days: string };
    }) => createElement("nav", { "data-page": String(props.currentPage), "data-total": props.totalPages,
      "data-path": props.basePath, "data-days": props.searchParams.days }) },
  };
}

function loadPage(kind: "slow-moving" | "expiry", before: boolean, imports: Record<string, unknown>): Page {
  const fileName = before ? join(ROOT, "__tests__/fixtures", `${kind}-before.tsx.txt`) : join(ROOT, kind, "page.tsx");
  const { outputText } = transpileModule(readFileSync(fileName, "utf8"), {
    fileName: `${kind}.tsx`, compilerOptions: {
      jsx: JsxEmit.ReactJSX, module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
    },
  });
  const exports: { default?: Page } = {};
  const resolveImport = (id: string): unknown => {
    assert.ok(Object.hasOwn(imports, id), `Unmocked page import: ${id}`);
    return imports[id];
  };
  new Function("exports", "require", outputText)(exports, resolveImport);
  assert.equal(typeof exports.default, "function");
  return exports.default!;
}

async function render(kind: "slow-moving" | "expiry", before: boolean, fixture: Fixture,
  params: { days?: string; page?: string }) {
  const trace: Trace = { saleRowsRead: 0, saleOrBranches: 0, permissions: [] };
  const page = loadPage(kind, before, dependencies(fixture, trace));
  const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }));
  assert.deepEqual(trace.permissions, ["lot_reports.view"]);
  return { html, trace };
}

function slowFixture(): Fixture {
  const products = ["p1", "p2", "p3", "p4"].map(product);
  const balances = [
    { productId: "p1", lotNo: "A", qtyOnHand: 5 },
    { productId: "p1", lotNo: "D", qtyOnHand: 25 },
    { productId: "p2", lotNo: "B", qtyOnHand: 15 },
    { productId: "p3", lotNo: "A", qtyOnHand: 20 },
    { productId: "p4", lotNo: "C", qtyOnHand: 3 },
  ].map((b) => ({ ...b, product: products.find((p) => p.id === b.productId)! }));
  const sale = (productId: string, lotNo: string, offset: number, status = "ACTIVE"): SaleLot => ({
    lotNo, saleItem: { productId, sale: { saleDate: dateAt(offset), status } },
  });
  return { products, balances, lots: balances.map((b) => ({ productId: b.productId, lotNo: b.lotNo, expDate: dateAt(30) })),
    sales: [sale("p1", "A", -220), sale("p1", "A", -150), sale("p1", "A", -1, "CANCELLED"),
      sale("p1", "D", -90), sale("p2", "B", -91), sale("p3", "A", -5),
      sale("p4", "C", -2, "CANCELLED"), sale("p1", "B", -1), sale("p2", "A", -200)] };
}

// The sale-lot lookup stays two flat IN lists: a per-product OR of
// saleItem.productId makes Prisma emit one SaleItem LEFT JOIN per branch.
test("slow-moving flat IN query preserves actual old markup without per-product OR branches", async () => {
  const fixture = slowFixture();
  for (const days of [undefined, "30", "90", "180", "365", "NaN", "-10"]) {
    const before = await render("slow-moving", true, fixture, { days });
    const after = await render("slow-moving", false, fixture, { days });
    assert.equal(after.html, before.html, `days=${days}`);
    assert.equal(before.trace.saleRowsRead, 7);
    assert.equal(after.trace.saleRowsRead, before.trace.saleRowsRead);
    assert.equal(after.trace.saleOrBranches, 0);
  }
  const { html } = await render("slow-moving", false, fixture, { days: "90" });
  const body = html.split("<tbody")[1];
  assert.ok(body.indexOf("Product p4") < body.indexOf("Product p1"), "never sold comes first");
  assert.ok(body.indexOf("Product p1") < body.indexOf("Product p2"), "older latest sale comes first");
  assert.ok(!body.includes("Product p3"), "same lot number for another product stays separate");
  assert.ok(!body.includes(">D</td>"), "exactly 90 days is excluded");
  assert.ok(body.includes(formatDateThai(dateAt(-150))), "latest non-cancelled sale is displayed");
  assert.ok(body.includes(">0.5</td>"), "fractional report-unit quantity is retained");
});

test("slow-moving retains the empty-stock response", async () => {
  const fixture: Fixture = { products: [], balances: [], lots: [], sales: [] };
  assert.equal((await render("slow-moving", false, fixture, {})).html,
    (await render("slow-moving", true, fixture, {})).html);
});

function expiryFixture(): Fixture {
  const products = ["p1", "p2"].map(product);
  const balances: Balance[] = [];
  const lots: Lot[] = [];
  for (let i = 0; i < 1105; i++) {
    const p = products[i % products.length];
    const key = { productId: p.id, lotNo: `L${String(Math.floor(i / 2)).padStart(4, "0")}` };
    balances.push({ ...key, qtyOnHand: i % 113 === 0 ? 0 : 5 + i / 10, product: p });
    lots.push({ ...key, expDate: i % 97 === 0 ? null : dateAt(Math.floor(i / 2) % 90 - 20) });
  }
  return { products, balances, lots, sales: [] };
}

test("expiry preserves actual old markup across thresholds, ties and all page boundaries", async () => {
  const fixture = expiryFixture();
  assert.ok(fixture.balances.filter((b) => b.qtyOnHand > 0).length > 1000);
  for (const days of [undefined, "7", "30", "90", "all"]) {
    const threshold = days === "all" ? undefined : dateAt(Number(days ?? 30));
    const matches = expiryOracle(fixture, threshold);
    const lastPage = Math.ceil(matches.length / PAGE_SIZE);
    for (const page of ["1", "2", String(lastPage), String(lastPage + 1), "NaN", "0", "-1"]) {
      assert.equal((await render("expiry", false, fixture, { days, page })).html,
        (await render("expiry", true, fixture, { days, page })).html, `days=${days}, page=${page}`);
    }
    assert.ok(matches.every((lot) => lot.qtyOnHand > 0 && lot.expDate !== null));
    if (threshold) assert.ok(matches.some((lot) => lot.expDate.getTime() === threshold.getTime())
      || Number(days) === 90, "threshold date is included");
  }
});

test("expiry retains zero-result markup when stock is zero or EXP is missing", async () => {
  const p = product("p1");
  const fixture: Fixture = { products: [p], sales: [],
    balances: [{ productId: p.id, lotNo: "ZERO", qtyOnHand: 0, product: p },
      { productId: p.id, lotNo: "NULL", qtyOnHand: 10, product: p }],
    lots: [{ productId: p.id, lotNo: "ZERO", expDate: TODAY },
      { productId: p.id, lotNo: "NULL", expDate: null }] };
  assert.equal((await render("expiry", false, fixture, { days: "all" })).html,
    (await render("expiry", true, fixture, { days: "all" })).html);
});

test("expiry falls back to 30 days for values outside the offered options", async () => {
  const fixture = expiryFixture();
  const expected = await render("expiry", false, fixture, { days: "30", page: "2" });
  for (const days of ["abc", "", "15", "-1", "1e3", "ALL", " 30"]) {
    const actual = await render("expiry", false, fixture, { days, page: "2" });
    assert.equal(actual.html, expected.html, `days=${JSON.stringify(days)}`);
  }
});
