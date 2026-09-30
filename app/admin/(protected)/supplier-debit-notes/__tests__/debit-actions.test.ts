import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";

class SupplierDebitPreviewRequiredError extends Error {}
class SupplierDebitStaleError extends Error {}

let authError: string | null = null;
let updateError: Error | null = null;
let createError: Error | null = null;
let cancelError: Error | null = null;
let permissions: string[] = [];
/** The override the action passed to the service (T1/T2 month lock). */
let lastOptions: unknown = null;
let actions: typeof import("../actions");
let PeriodLockedError: typeof import("@/lib/period-lock").PeriodLockedError;

before(async () => {
  const guard = async () => {
    if (authError) throw new Error(authError);
    return { user: { id: "user-1", permissions } };
  };
  ({ PeriodLockedError } = await import("@/lib/period-lock"));
  await mock.module("@/lib/require-auth", { namedExports: { requirePermission: guard, requireAnyPermission: guard } });
  await mock.module("@/lib/audit-log", { namedExports: {
    getAuditActorFromSession: () => ({ actorId: "user-1" }), getRequestContext: async () => ({}),
  } });
  await mock.module("@/lib/supplier-debit-note", { namedExports: {
    SupplierDebitPreviewRequiredError, SupplierDebitStaleError,
    previewSupplierDebitNote: async () => ({ subtotalAmount: 0, vatAmount: 0, netAmount: 0, inventoryAmount: 0, varianceAmount: 0 }),
    postSupplierDebitNote: async () => {
      if (createError) throw createError;
      return { id: "dn", debitNo: "SDN26090001" };
    },
    cancelSupplierDebitNote: async (_id: string, _note: string, _actor: unknown, options: unknown) => {
      lastOptions = options;
      if (cancelError) throw cancelError;
    },
    toSupplierDebitLockedPeriods: (periods: Array<{ periodKey: string; distributionNo: string }>) =>
      periods.map((period) => ({ periodKey: period.periodKey, label: "กันยายน 2026", distributionNo: period.distributionNo })),
    updateSupplierDebitNote: async () => {
      if (updateError) throw updateError;
      return { id: "dn", debitNo: "SDN26090001", reposted: false };
    },
  } });
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  actions = await import("../actions");
});

beforeEach(() => { authError = null; updateError = null; createError = null; cancelError = null; permissions = []; lastOptions = null; });

describe("supplier DN actions: user-facing errors (F8a, F3)", () => {
  for (const code of ["UNAUTHORIZED", "FORBIDDEN"]) {
    it(`${code} shows the no-permission message instead of "invalid data"`, async () => {
      authError = code;
      assert.deepEqual(await actions.createDebit({}), { error: "ไม่มีสิทธิ์เข้าถึง" });
      assert.deepEqual(await actions.updateDebit("dn", {}), { error: "ไม่มีสิทธิ์เข้าถึง" });
      assert.deepEqual(await actions.cancelDebit("dn", "note"), { error: "ไม่มีสิทธิ์เข้าถึง" });
      assert.deepEqual(await actions.previewDebit({}), { error: "ไม่มีสิทธิ์เข้าถึง" });
    });
  }

  it("a server-side preview demand re-enables the preview button on the form", async () => {
    updateError = new SupplierDebitPreviewRequiredError("ยอดจัดสรรต้นทุนเปลี่ยนหรือยังไม่ได้ตรวจยอด กรุณาตรวจยอดอีกครั้งก่อนบันทึก");
    const result = await actions.updateDebit("dn", {});
    assert.equal(result.previewRequired, true);
    assert.equal(result.stale, undefined);
    assert.match(result.error ?? "", /ตรวจยอด/);
  });

  it("a stale edit tells the form to reload", async () => {
    updateError = new SupplierDebitStaleError("เอกสารนี้ถูกแก้ไขโดยผู้อื่นระหว่างที่คุณแก้ไข กรุณาโหลดหน้าใหม่");
    const result = await actions.updateDebit("dn", {});
    assert.equal(result.stale, true);
    assert.equal(result.previewRequired, undefined);
    assert.match(result.error ?? "", /โหลดหน้าใหม่/);
  });

  it("T4: a supplier DN number held by an ACTIVE DN reaches the form as the service's Thai message, on create and edit", async () => {
    const message = "เลข DN ของซัพพลายเออร์ซ้ำกับ SDN26080001 (เลขของซัพพลายเออร์ DN-001) ที่ยังใช้งานอยู่ · " +
      "เลขที่ต่างกันเพียงตัวพิมพ์เล็ก-ใหญ่ เว้นวรรค จุด / หรือ - ถือเป็นเลขเดียวกัน · ใช้เลขซ้ำได้เมื่อยกเลิก DN เดิมแล้วเท่านั้น";
    createError = new Error(message); updateError = new Error(message);
    assert.deepEqual(await actions.createDebit({}), { error: message });
    assert.deepEqual(await actions.updateDebit("dn", {}), { error: message });
  });

  it("T4: any other unique violation shows the generic Thai message, never a duplicate-number claim or raw DB text", async () => {
    const generic = "ข้อมูลไม่ถูกต้องหรือไม่สามารถบันทึกได้ กรุณาตรวจสอบแล้วลองใหม่";
    createError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`debitNo`)", { code: "P2002", clientVersion: "test" });
    updateError = createError;
    assert.deepEqual(await actions.createDebit({}), { error: generic });
    assert.deepEqual(await actions.updateDebit("dn", {}), { error: generic });
  });

  it("month lock: a locked cancel tells the form which months and whether this user may override", async () => {
    const periods = [{ periodKey: "2026-09", distributionNo: "PD1", label: "x" }];
    cancelError = new PeriodLockedError("เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว", periods);
    assert.deepEqual(await actions.cancelDebit("dn", "note", "เหตุผลยาวพอ"), { error: "เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว",
      periodLock: { canOverride: false, periods: [{ periodKey: "2026-09", label: "กันยายน 2026", distributionNo: "PD1" }] } });
    // Without the permission the reason is never forwarded as an override.
    assert.deepEqual(lastOptions, { periodLockOverride: { allowed: false, reason: null } });
    permissions = ["period_lock.override"];
    const result = await actions.cancelDebit("dn", "note", "เหตุผลยาวพอ");
    assert.equal(result.periodLock?.canOverride, true);
    assert.deepEqual(lastOptions, { periodLockOverride: { allowed: true, reason: "เหตุผลยาวพอ" } });
  });

  it("R4: a locked header date reaches the form as the same Thai reason, without preview or reload flags", async () => {
    const reason = "แก้ไขวันครบกำหนดชำระไม่ได้: DN นี้ชำระครบแล้ว ไม่มียอดค้างจ่าย";
    updateError = new Error(reason);
    assert.deepEqual(await actions.updateDebit("dn", {}), { error: reason });
  });
});
