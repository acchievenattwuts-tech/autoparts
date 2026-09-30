import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/** "ปรับยอด DN" server actions: DN create permission, Thai errors, preview-required and month-lock responses. */
class SupplierDebitPreviewRequiredError extends Error {}
let authError: string | null = null;
let postError: Error | null = null;
let permissions: string[] = [];
let lastOptions: unknown = null;
let requested: string[] = [];
let actions: typeof import("../actions");
let PeriodLockedError: typeof import("@/lib/period-lock").PeriodLockedError;

before(async () => {
  ({ PeriodLockedError } = await import("@/lib/period-lock"));
  const guard = async (permission: string) => {
    requested.push(permission);
    if (authError) throw new Error(authError);
    return { user: { id: "user-1", permissions } };
  };
  await mock.module("@/lib/require-auth", { namedExports: { requirePermission: guard, requireAnyPermission: guard } });
  await mock.module("@/lib/audit-log", { namedExports: { getAuditActorFromSession: () => ({ userId: "user-1" }), getRequestContext: async () => ({}) } });
  await mock.module("@/lib/supplier-debit-note", { namedExports: {
    SupplierDebitPreviewRequiredError, SupplierDebitStaleError: class extends Error {},
    toSupplierDebitLockedPeriods: (periods: Array<{ periodKey: string; distributionNo: string }>) =>
      periods.map((period) => ({ periodKey: period.periodKey, label: "กันยายน 2026", distributionNo: period.distributionNo })),
  } });
  await mock.module("@/lib/supplier-debit-adjustment", { namedExports: {
    previewSupplierDebitAdjustment: async () => ({ direction: "DECREASE", netAmount: -200, excessAmount: 200 }),
    postSupplierDebitAdjustment: async (_raw: unknown, _actor: unknown, options: unknown) => {
      lastOptions = options;
      if (postError) throw postError;
      return { id: "adj-1", debitNo: "SDN26090002" };
    },
  } });
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  actions = await import("../actions");
});
beforeEach(() => { authError = null; postError = null; permissions = []; lastOptions = null; requested = []; });

describe("ปรับยอด DN actions", () => {
  it("needs the DN create permission and shows the shared no-permission message", async () => {
    authError = "FORBIDDEN";
    assert.deepEqual(await actions.createDebitAdjustment({}), { error: "ไม่มีสิทธิ์เข้าถึง" });
    assert.deepEqual(await actions.previewDebitAdjustment({}), { error: "ไม่มีสิทธิ์เข้าถึง" });
    assert.deepEqual(requested, ["supplier_debit_notes.create", "supplier_debit_notes.create"]);
  });

  it("returns the new document number on success", async () => {
    assert.deepEqual(await actions.createDebitAdjustment({}), { id: "adj-1", debitNo: "SDN26090002" });
    assert.deepEqual(lastOptions, { periodLockOverride: { allowed: false, reason: null } });
  });

  it("a moved parent balance asks the form for a new preview; Thai service errors pass through", async () => {
    postError = new SupplierDebitPreviewRequiredError("ยอดจัดสรรต้นทุนเปลี่ยนหรือยังไม่ได้ตรวจยอด กรุณาตรวจยอดอีกครั้งก่อนบันทึก");
    const stale = await actions.createDebitAdjustment({});
    assert.equal(stale.previewRequired, true);
    postError = new Error("ยอดที่ลดเกินยอดค้างของ DN ต้นทาง กรุณาเลือกว่าจะเก็บเป็นเครดิตซัพพลายเออร์หรือรับเงินคืน");
    assert.deepEqual(await actions.createDebitAdjustment({}), { error: postError.message });
  });

  it("today's distributed month: the form learns the months and whether this user may override", async () => {
    permissions = ["period_lock.override"];
    postError = new PeriodLockedError("เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว", [{ periodKey: "2026-09", distributionNo: "PD1", label: "x" }]);
    const result = await actions.createDebitAdjustment({}, "เหตุผลยาวพอ");
    assert.deepEqual(result.periodLock, { canOverride: true, periods: [{ periodKey: "2026-09", label: "กันยายน 2026", distributionNo: "PD1" }] });
    assert.deepEqual(lastOptions, { periodLockOverride: { allowed: true, reason: "เหตุผลยาวพอ" } });
  });
});
