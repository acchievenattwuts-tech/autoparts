import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import type { MutationBlockResult } from "@/lib/document-mutation-guard";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Y1 (owner 2026-09-30): the purchase-return detail page shows the cancel button next to "แก้ไข" (the list page's
// PurchaseReturnCancelButton, outlined) only with purchase_returns.cancel and when the reference-chain guard allows
// the cancel; otherwise the guard's own message and links. SSR with the database, session and guard mocked.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;

const OPEN: MutationBlockResult = { blocked: false, reason: null, references: [] };
const PAID: MutationBlockResult = { blocked: true, reason: "ถูกนำไปใช้ที่เอกสารจ่ายชำระ",
  references: [{ entityType: "SupplierPayment", id: "sp1", refNo: "SP26090001" }] };

let permissions: string[] = [];
let guard: MutationBlockResult = OPEN;
let guardCalls: Array<[string, string, string]> = [];
let declared: Record<string, string> = {};
let storedReturn: Record<string, unknown> = {};

const returnRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "pr1", returnNo: "PR26090001", returnDate: parseDateOnlyToDate("2026-08-20"),
  createdAt: new Date("2026-09-29T03:00:00.000Z"), status: "ACTIVE", type: "RETURN", claimId: null, purchaseId: null,
  settlementType: "SUPPLIER_CREDIT", vatType: "NO_VAT", vatRate: 0, taxInvoiceNo: null, taxInvoiceDate: null,
  amountRemain: 200, subtotalAmount: 200, vatAmount: 0, totalAmount: 200, note: null, cancelNote: null,
  supplier: { name: "Supplier A" }, purchase: null, claim: null, cashBankAccount: null, user: { name: "Admin" },
  items: [{ id: "pri-1", productId: "p-1", qty: 10, costPrice: 20, unitScale: 1, showQty: 10, showUnitName: "ชิ้น",
    showPricePerUnit: 20, amount: 200, moreDetail: null, lotItems: [], product: { code: "P1", name: "ไส้กรอง" } }],
  ...overrides,
});

const overrides = (): ModelOverrides => ({
  purchaseReturn: { findUnique: async () => storedReturn },
  profitDistribution: { findMany: async (args) => {
    const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
    return keys.filter((key) => declared[key]).map((key) => ({ activePeriodKey: key, distributionNo: declared[key] }));
  } },
});

const fakeDb = new Proxy({}, {
  get: (_target, modelName: string) => {
    if (modelName === "$executeRaw" || modelName === "$queryRaw") return async () => (modelName === "$queryRaw" ? [] : 0);
    return new Proxy({}, {
      get: (_m, method: string) => async (args: unknown) => {
        const override = overrides()[modelName]?.[method];
        if (override) return override(args);
        if (method === "findMany") return [];
        return null;
      },
    });
  },
});

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", { namedExports: { ...realDb, db: fakeDb,
    dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb) } });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", { namedExports: { ...realAuth,
    requirePermission: async () => ({ user: { id: "user-1", permissions } }),
    getSessionPermissionContext: async () => ({ role: "STAFF", permissions }),
  } });
  const realGuard = await import("@/lib/document-mutation-guard");
  await mock.module("@/lib/document-mutation-guard", { namedExports: { ...realGuard,
    checkDocumentMutation: async (entityType: string, entityId: string, action: string) => {
      guardCalls.push([entityType, entityId, action]);
      return guard;
    },
  } });
  const realActivity = await import("@/lib/document-activity");
  await mock.module("@/lib/document-activity", { namedExports: { ...realActivity, getDocumentActivityTimeline: async () => [] } });
  const realNavigation = await import("next/navigation");
  await mock.module("next/navigation", { namedExports: { ...realNavigation,
    useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  } });
});

beforeEach(() => {
  permissions = ["purchase_returns.view", "purchase_returns.update", "purchase_returns.cancel"];
  guard = OPEN;
  guardCalls = [];
  declared = {};
  storedReturn = returnRow();
});

const renderDetail = async (): Promise<string> => {
  const { default: DetailPage } = await import("../[id]/page");
  const page: ReactElement = await DetailPage({ params: Promise.resolve({ id: "pr1" }) });
  return renderToStaticMarkup(page);
};

/** The rendered cancel trigger (CancelDocButton), or undefined when the page renders none. */
const cancelButton = (html: string): string | undefined =>
  html.match(/<button[^>]*title="[^"]*"[^>]*>(?:(?!<\/button>).)*ยกเลิก<\/button>/)?.[0];

test("Y1: an ACTIVE return with purchase_returns.cancel shows the outlined cancel button next to แก้ไข, light and dark",
  { skip: moduleMocksUnavailable }, async () => {
    const html = await renderDetail();
    const button = cancelButton(html);
    assert.ok(button, "the cancel button renders");
    assert.match(button, /title="ยกเลิกเอกสาร"/);
    assert.doesNotMatch(button, /disabled=""/);
    assert.match(button, /rounded-lg border border-red-200[^"]*dark:border-rose-400\/30[^"]*dark:text-rose-300/);
    assert.ok(html.indexOf("แก้ไข") < html.indexOf(button), "after the edit link");
    assert.deepEqual(guardCalls, [["PurchaseReturn", "pr1", "cancel"]], "the guard cancelPurchaseReturn runs");
    assert.doesNotMatch(html, /ยกเลิกไม่ได้/);
  });

test("Y1: without purchase_returns.cancel there is no cancel button and no guard query", { skip: moduleMocksUnavailable }, async () => {
  permissions = ["purchase_returns.view", "purchase_returns.update"];
  const html = await renderDetail();
  assert.equal(cancelButton(html), undefined);
  assert.deepEqual(guardCalls, []);
  assert.match(html, /แก้ไข/, "the edit link stays");
});

test("Y1: a cancelled return shows no cancel button", { skip: moduleMocksUnavailable }, async () => {
  storedReturn = returnRow({ status: "CANCELLED", cancelNote: "คีย์ซ้ำ" });
  const html = await renderDetail();
  assert.equal(cancelButton(html), undefined);
  assert.deepEqual(guardCalls, []);
});

test("Y1: a return the guard blocks shows the shared guard reason with its links instead of the button",
  { skip: moduleMocksUnavailable }, async () => {
    guard = PAID;
    const html = await renderDetail();
    assert.equal(cancelButton(html), undefined);
    assert.ok(html.includes("ยกเลิกไม่ได้:"));
    assert.ok(html.includes("ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่เอกสารจ่ายชำระ: SP26090001"), "buildMutationBlockMessage");
    assert.match(html, /href="\/admin\/supplier-payments\/sp1"[^>]*>SP26090001<\/a>/);
    assert.match(html, /bg-amber-50[^"]*dark:bg-amber-500\/10/);
  });

test("Y1: a declared return month disables the button for staff with the lock message; an owner may open the dialog",
  { skip: moduleMocksUnavailable }, async () => {
    declared = { "2026-08": "PD2026080001" };
    const staff = cancelButton(await renderDetail());
    assert.ok(staff?.includes("disabled=\"\""), staff);
    assert.match(staff ?? "", /title="[^"]*PD2026080001[^"]*"/);

    permissions = [...permissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
    const owner = cancelButton(await renderDetail());
    assert.ok(owner, "the owner still gets the button");
    assert.doesNotMatch(owner, /disabled=""/);
  });

test("Y1: a DISCOUNT return also checks its ลดราคาซื้อ posting month (the return's creation date)",
  { skip: moduleMocksUnavailable }, async () => {
    storedReturn = returnRow({ type: "DISCOUNT" });
    declared = { "2026-09": "PD2026090001" };
    const button = cancelButton(await renderDetail());
    assert.match(button ?? "", /title="[^"]*PD2026090001[^"]*"/);
  });
