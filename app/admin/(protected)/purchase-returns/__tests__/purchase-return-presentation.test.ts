import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PURCHASE_RETURN_SETTLEMENT_LABELS,
  PURCHASE_RETURN_TYPE_CHANGE_MESSAGE,
  hasPurchaseReturnSupplierCredit,
  isPurchaseReturnTypeChangeAllowed,
} from "../purchase-return-presentation";
import { resolvePurchaseReturnCancelLock } from "../purchase-return-cancel-preview";
import type { PeriodLockView } from "@/lib/period-lock-view";

const ROUTE_DIR = path.join(process.cwd(), "app", "admin", "(protected)", "purchase-returns");
const readRouteFile = (...segments: string[]): string =>
  readFileSync(path.join(ROUTE_DIR, ...segments), "utf8");

test("settlement labels keep the form's existing Thai wording for every enum value", () => {
  assert.deepEqual(PURCHASE_RETURN_SETTLEMENT_LABELS, {
    CASH_REFUND: "รับเงินคืน",
    SUPPLIER_CREDIT: "เครดิตซัพพลายเออร์",
  });
});

test("only a supplier-credit return shows a remaining credit balance", () => {
  assert.equal(hasPurchaseReturnSupplierCredit("SUPPLIER_CREDIT"), true);
  assert.equal(hasPurchaseReturnSupplierCredit("CASH_REFUND"), false);
});

test("detail page shows settlement type, remaining credit and the linked claim", () => {
  const source = readRouteFile("[id]", "page.tsx");
  assert.match(source, /claim: \{ select: \{ id: true, claimNo: true \} \}/);
  assert.match(source, /PURCHASE_RETURN_SETTLEMENT_LABELS\[ret\.settlementType\]/);
  assert.match(source, /hasPurchaseReturnSupplierCredit\(ret\.settlementType\)/);
  assert.match(source, /ret\.amountRemain/);
  assert.match(source, /href=\{`\/admin\/warranty-claims\/\$\{ret\.claim\.id\}`\}/);
});

test("form toggle and detail page share one settlement label source", () => {
  const form = readRouteFile("new", "PurchaseReturnForm.tsx");
  assert.match(form, /PURCHASE_RETURN_SETTLEMENT_LABELS\.CASH_REFUND/);
  assert.match(form, /PURCHASE_RETURN_SETTLEMENT_LABELS\.SUPPLIER_CREDIT/);
});

test("X3: an edit may switch DISCOUNT ↔ OTHER, never RETURN ↔ DISCOUNT/OTHER", () => {
  const types = ["RETURN", "DISCOUNT", "OTHER"];
  const allowed = types.flatMap((from) => types.filter((to) => isPurchaseReturnTypeChangeAllowed(from, to)).map((to) => `${from}>${to}`));
  assert.deepEqual(allowed, ["RETURN>RETURN", "DISCOUNT>DISCOUNT", "DISCOUNT>OTHER", "OTHER>DISCOUNT", "OTHER>OTHER"]);
  assert.match(PURCHASE_RETURN_TYPE_CHANGE_MESSAGE, /ยกเลิกเอกสารนี้แล้วบันทึกเอกสารใหม่/);
});

test("X3: the edit form disables the other type family with the server's message, in light and dark", () => {
  const form = readRouteFile("new", "PurchaseReturnForm.tsx");
  assert.match(form, /isPurchaseReturnTypeChangeAllowed\(initialData\.type, value\)/);
  assert.match(form, /disabled=\{typeLocked\}/);
  assert.match(form, /cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-slate-900 dark:text-slate-600/);
  assert.match(form, /\{PURCHASE_RETURN_TYPE_CHANGE_MESSAGE\}/);
});

test("X4: the cancel dialog acts on the server's lock, else the loaded preview, else the page's view", () => {
  const view = (label: string, canOverride: boolean): PeriodLockView => ({ message: label, canOverride, periodLabels: [label] });
  const page = view("page", true);
  const open = { block: null, periodLock: null, restatement: null };
  assert.deepEqual(resolvePurchaseReturnCancelLock({ initial: null, preview: open, server: null }),
    { lock: null, asksReason: false, blocks: false }, "no lock: no reason field");
  assert.deepEqual(resolvePurchaseReturnCancelLock({ initial: page, preview: null, server: null }),
    { lock: page, asksReason: true, blocks: false }, "preview loading or failed: the page's view");
  assert.equal(resolvePurchaseReturnCancelLock({ initial: page, preview: open, server: null }).lock, null,
    "the preview is exact and replaces the page's view");
  const later = view("later sale", true);
  assert.deepEqual(resolvePurchaseReturnCancelLock({ initial: null, preview: { block: null, periodLock: later, restatement: null }, server: null }),
    { lock: later, asksReason: true, blocks: false }, "a locked later-sale month asks an owner for the reason");
  const server = view("server", false);
  assert.deepEqual(resolvePurchaseReturnCancelLock({ initial: null, preview: open, server }),
    { lock: server, asksReason: false, blocks: true }, "a server rejection wins");
});

test("X4: the cancel button loads the preview when the dialog opens and waits for it before confirming", () => {
  const button = readRouteFile("PurchaseReturnCancelButton.tsx");
  assert.match(button, /previewPurchaseReturnCancel\(returnId\)/);
  assert.match(button, /onOpen=\{\(\) => \{ void loadPreview\(\); \}\}/);
  assert.match(button, /confirmDisabled=\{status === "loading" \|\| blocks \|\| block !== null\}/);
  assert.match(button, /if \(result\.periodLock\) setServerLock\(result\.periodLock\)/);
});
