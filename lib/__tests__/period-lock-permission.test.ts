import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PERMISSION_CATALOG, resolveUserPermissionKeys } from "@/lib/access-control";
import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";

// Owner decision ก1: unlocking a document in a month whose profit was distributed is an
// ADMIN-only permission (never part of the STAFF role templates). Cash-only documents
// (receipts, supplier payments, transfers, advances) are outside the month lock.

const readSource = (relativePath: string): string => readFileSync(path.join(process.cwd(), relativePath), "utf8");

/** The body of `const NAME: PermissionKey[] = [ ... ];` in lib/access-control.ts. */
const permissionListSource = (source: string, name: string): string => {
  const start = source.indexOf(`const ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const end = source.indexOf("];", start);
  return source.slice(start, end);
};

test("the override permission is in the catalog with its Thai group and label", () => {
  const entry = PERMISSION_CATALOG.find((permission) => permission.key === PERIOD_LOCK_OVERRIDE_PERMISSION);
  assert.ok(entry);
  assert.equal(entry.key, "period_lock.override");
  assert.equal(entry.group, "แก้เอกสารในเดือนที่ปันผลแล้ว");
  assert.equal(entry.label, "แก้เอกสารในเดือนที่ปันผลแล้ว");
});

test("an ADMIN gets it; a staff account without a direct grant does not", () => {
  const admin = resolveUserPermissionKeys({ role: "ADMIN", appRolePermissionKeys: [], directPermissionKeys: [] });
  assert.ok(admin.includes(PERIOD_LOCK_OVERRIDE_PERMISSION));
  const staff = resolveUserPermissionKeys({
    role: "STAFF",
    appRolePermissionKeys: ["sales.update", "sales.cancel"],
    directPermissionKeys: [],
  });
  assert.ok(!staff.includes(PERIOD_LOCK_OVERRIDE_PERMISSION));
});

test("the STAFF role templates never include it", () => {
  const source = readSource("lib/access-control.ts");
  for (const list of ["STAFF_OPERATIONS_PERMISSIONS", "STAFF_VIEWER_PERMISSIONS"]) {
    const body = permissionListSource(source, list);
    assert.doesNotMatch(body, /period_lock/);
    assert.doesNotMatch(body, /PERIOD_LOCK_OVERRIDE_PERMISSION/);
  }
});

test("cash-only documents are not month-locked", () => {
  const cashOnlyActions = [
    "app/admin/(protected)/receipts/actions.ts",
    "app/admin/(protected)/supplier-payments/actions.ts",
    "app/admin/(protected)/customer-advances/actions.ts",
    "app/admin/(protected)/supplier-advances/actions.ts",
    "app/admin/(protected)/cash-bank/actions.ts",
  ];
  for (const file of cashOnlyActions) {
    assert.doesNotMatch(readSource(file), /period-lock/, `${file} must not use the month lock`);
  }
});

test("every month-locked document action takes the lock", () => {
  const lockedActions = [
    "app/admin/(protected)/sales/actions.ts",
    "app/admin/(protected)/credit-notes/actions.ts",
    "app/admin/(protected)/expenses/actions.ts",
    "app/admin/(protected)/purchases/actions.ts",
    "app/admin/(protected)/purchase-returns/actions.ts",
    "app/admin/(protected)/stock/adjustments/actions.ts",
    "app/admin/(protected)/stock/bf/actions.ts",
    "app/admin/(protected)/warranty-claims/actions.ts",
    "app/admin/(protected)/sales/_marketplace/actions.ts",
    "lib/shopee/services/create-sale.ts",
  ];
  for (const file of lockedActions) {
    const source = readSource(file);
    assert.match(source, /assertPeriodsUnlocked|resolveDocumentPeriodLock/, `${file} must check the month lock`);
    assert.match(source, /PeriodLockedError/, `${file} must map PeriodLockedError to its Thai message`);
  }
});
