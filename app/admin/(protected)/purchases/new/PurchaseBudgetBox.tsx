"use client";

import { CircleCheck, OctagonAlert, TriangleAlert, Wallet } from "lucide-react";

import {
  BUDGET_STATUS_STYLE,
  formatBaht,
  formatPercent,
  formatSignedBaht,
} from "@/components/shared/purchase-budget-ui";
import {
  previewPurchaseBudget,
  type PurchaseBudgetFormView,
  type PurchaseBudgetLevel,
} from "@/lib/purchase-budget-core";

/**
 * Display only (owner decision 2026-10-03): how much purchase budget this bill uses and what is left
 * after saving. It never blocks or changes the save — the purchase flow is untouched.
 */

type PurchaseBudgetBoxProps = {
  view: PurchaseBudgetFormView;
  /** Remaining budget with the bill as it is saved now (or without it before the first save). */
  remainingBefore: number;
  /** Budget the form's current values use beyond what is already saved. */
  usage: number;
  /** The bill already exists, so the middle figure is a difference against the saved bill. */
  hasSavedVersion: boolean;
};

const BOX_TONE: Record<PurchaseBudgetLevel, string> = {
  ok: "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5",
  low: "border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-400/10",
  over: "border-rose-200 bg-rose-50 dark:border-rose-400/30 dark:bg-rose-400/10",
};

const messageFor = (level: PurchaseBudgetLevel, remainingAfter: number, remainingAfterPct: number, thresholdPct: number): string => {
  if (level === "over") return `หลังบันทึก งบจะเกินเพดาน ${formatBaht(-remainingAfter)} บาท · ยังบันทึกใบซื้อได้ตามปกติ ระบบไม่บล็อก`;
  if (level === "low") return `หลังบันทึก งบจะเหลือ ${formatPercent(remainingAfterPct)}% ของเพดาน ต่ำกว่าเส้นเตือน ${thresholdPct}%`;
  return `หลังบันทึก งบยังเหลือ ${formatPercent(remainingAfterPct)}% ของเพดาน`;
};

const PurchaseBudgetBox = ({ view, remainingBefore, usage, hasSavedVersion }: PurchaseBudgetBoxProps) => {
  const preview = previewPurchaseBudget(view, remainingBefore, usage);
  const style = BUDGET_STATUS_STYLE[preview.levelAfter];
  const Icon = preview.levelAfter === "ok" ? CircleCheck : preview.levelAfter === "low" ? TriangleAlert : OctagonAlert;
  const plainTone = "text-slate-900 dark:text-slate-100";
  const stats = [
    { label: hasSavedVersion ? "งบคงเหลือตอนนี้" : "งบคงเหลือก่อนบิลนี้", value: formatBaht(preview.remainingBefore), tone: plainTone },
    { label: hasSavedVersion ? "ส่วนต่างจากที่บันทึกไว้" : "บิลนี้ใช้งบ", value: formatSignedBaht(-preview.usage), tone: plainTone },
    {
      label: "คงเหลือหลังบันทึก",
      value: formatBaht(preview.remainingAfter),
      tone: preview.remainingAfter < 0 ? "font-bold text-rose-700 dark:text-rose-300" : `font-bold ${plainTone}`,
    },
  ];

  return (
    <div role="status" className={`space-y-2.5 rounded-xl border px-4 py-3 ${BOX_TONE[preview.levelAfter]}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-kanit text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Wallet size={18} aria-hidden /> งบสั่งซื้อ
        </p>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${style.chip}`}>
          <Icon size={14} aria-hidden /> {style.label}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className={`text-[15px] font-semibold tabular-nums ${stat.tone}`}>{stat.value}</p>
          </div>
        ))}
      </div>
      <p className={`text-sm font-semibold ${style.message}`}>
        {messageFor(preview.levelAfter, preview.remainingAfter, preview.remainingAfterPct, view.thresholdPct)}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">บิลนี้ใช้งบ = มูลค่าที่เข้าสต็อก ไม่นับ VAT ที่ขอคืนได้ · รวมค่าขนส่ง · หักส่วนลดท้ายบิล</p>
    </div>
  );
};

export default PurchaseBudgetBox;
