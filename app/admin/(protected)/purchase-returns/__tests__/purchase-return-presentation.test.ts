import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PURCHASE_RETURN_SETTLEMENT_LABELS,
  hasPurchaseReturnSupplierCredit,
} from "../purchase-return-presentation";

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
