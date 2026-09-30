import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PERIOD_LOCK_REASON_LABEL, type PeriodLockView } from "@/lib/period-lock-view";
import SettlementManager from "../SettlementManager";

// Owner decision S2 (UI): the settlement history shows the month-lock notice — with the reason
// field only for an admin holding period_lock.override — when the settlement date or a sale month
// its fee / income is still dated in has been declared. The hint says why an open-month settlement
// is locked. Light and dark classes come from the shared PeriodLockControls.

Object.assign(globalThis, { React });

const HINT = "ค่าธรรมเนียม/รายรับพิเศษของรอบนี้ยังลงวันที่ขายในเดือนที่ประกาศปันผลภายหลัง การยกเลิกจะเปลี่ยนกำไรของเดือนนั้น";

const lockView = (canOverride: boolean): PeriodLockView => ({
  message: "เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว: สิงหาคม 2026 (PD2026080001)",
  canOverride,
  periodLabels: ["สิงหาคม 2026"],
});

const render = (periodLock: PeriodLockView | null, periodLockHint: string | null): string =>
  renderToStaticMarkup(
    React.createElement(SettlementManager, {
      channel: "SHOPEE",
      channelLabel: "Shopee",
      orderRefLabel: "เลขคำสั่งซื้อ",
      sales: [],
      creditNotes: [],
      accounts: [],
      today: "2026-09-30",
      canCancel: true,
      history: [{
        id: "set-1",
        no: "SPS26090001",
        ref: "PAYOUT-1",
        date: "05/09/2026",
        sales: 1000,
        returns: 0,
        fees: 100,
        income: 0,
        payout: 900,
        status: "ACTIVE",
        periodLock,
        periodLockHint,
        feeDating: null,
      }],
    }),
  );

test("an admin with the override sees the notice, the hint and the reason field (light + dark)", () => {
  const html = render(lockView(true), HINT);
  assert.match(html, /เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว: สิงหาคม 2026 \(PD2026080001\)/);
  assert.ok(html.includes(HINT));
  assert.ok(html.includes(PERIOD_LOCK_REASON_LABEL));
  assert.match(html, /<textarea/);
  assert.match(html, /bg-amber-50[^"]*dark:bg-amber-400\/10/);
  assert.match(html, /dark:border-amber-300\/30[^"]*dark:bg-slate-900/);
});

test("without the override: notice only, no reason field, and the cancel button is disabled with the message", () => {
  const html = render(lockView(false), HINT);
  assert.ok(html.includes(HINT));
  assert.doesNotMatch(html, /<textarea/);
  assert.match(html, /<button[^>]*disabled=""[^>]*title="เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว/);
});

test("an open settlement shows no lock notice", () => {
  const html = render(null, null);
  assert.doesNotMatch(html, /ประกาศปันผลแล้ว/);
  assert.doesNotMatch(html, /<textarea/);
});
