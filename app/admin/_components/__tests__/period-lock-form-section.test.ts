import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PERIOD_LOCK_REASON_FIELD, type PeriodLockView } from "@/lib/period-lock-view";
import { PeriodLockFormSection, usePeriodLockFinancialChange } from "../PeriodLockControls";

// Owner decision P3: in a month locked by a profit distribution, an admin holding
// period_lock.override is asked for a reason only when the edit is financial. The form's hint
// hides the reason box for a non-financial change; once the server rejects for the lock, the box
// comes back so the admin is never left without it.

Object.assign(globalThis, { React });

const adminLock: PeriodLockView = {
  message: "เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว: สิงหาคม 2026 (PD2026080001) จึงแก้ไขหรือยกเลิกตัวเลขไม่ได้",
  canOverride: true,
  periodLabels: ["สิงหาคม 2026"],
};
const staffLock: PeriodLockView = { ...adminLock, canOverride: false };
const LOCK_REJECTION = `${adminLock.message} (เหตุผลต้องยาวอย่างน้อย 5 ตัวอักษร)`;

const renderSection = (lock: PeriodLockView | null, financialChange?: boolean): string =>
  renderToStaticMarkup(React.createElement(PeriodLockFormSection, { lock, financialChange }));

const asksReason = (html: string): boolean => html.includes(`name="${PERIOD_LOCK_REASON_FIELD}"`);

test("the reason box is asked for only when the change is financial", () => {
  const nonFinancial = renderSection(adminLock, false);
  assert.equal(asksReason(nonFinancial), false);
  assert.ok(nonFinancial.includes("ไม่ต้องระบุเหตุผล"), "the admin is told why no reason is needed");
  assert.equal(asksReason(renderSection(adminLock, true)), true);
  assert.equal(asksReason(renderSection(adminLock)), true, "a form that does not track changes keeps asking");
  assert.equal(asksReason(renderSection(staffLock, true)), false, "no override permission, no reason box");
  assert.equal(renderSection(null, true), "");
});

type ProbeProps = { lock: PeriodLockView | null; snapshot: unknown; error?: string };

const Probe = ({ lock, snapshot, error }: ProbeProps) => {
  const { financialChange } = usePeriodLockFinancialChange(lock, snapshot, error);
  return React.createElement("output", null, financialChange ? "financial" : "non-financial");
};

const probe = (props: ProbeProps): string => renderToStaticMarkup(React.createElement(Probe, props));

test("the loaded state is the baseline; a lock rejection from the server turns the reason on", () => {
  const snapshot = { saleDate: "2026-08-20", lines: [{ productId: "p-1", qty: 1 }] };
  assert.ok(probe({ lock: adminLock, snapshot }).includes(">non-financial<"));
  assert.ok(probe({ lock: adminLock, snapshot, error: LOCK_REJECTION }).includes(">financial<"));
  assert.ok(probe({ lock: adminLock, snapshot, error: "จำนวนต้องมากกว่า 0" }).includes(">non-financial<"));
  assert.ok(probe({ lock: staffLock, snapshot, error: LOCK_REJECTION }).includes(">non-financial<"));
  assert.ok(probe({ lock: null, snapshot }).includes(">non-financial<"));
});
