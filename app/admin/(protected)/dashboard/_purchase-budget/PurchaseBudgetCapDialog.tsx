"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";

import {
  applyPurchaseBudgetCapChange,
  PURCHASE_BUDGET_MAX_THRESHOLD_PCT,
  type PurchaseBudgetCapMode,
} from "@/lib/purchase-budget-core";

import { updatePurchaseBudgetCap } from "../purchase-budget-actions";
import { formatBaht } from "@/components/shared/purchase-budget-ui";

type PurchaseBudgetCapDialogProps = {
  /** "setup" = no cap yet: only "กำหนดค่าใหม่" is offered. */
  variant: "setup" | "adjust";
  cap: number | null;
  thresholdPct: number;
  /** Stock value + open deposits + non-tracked net: what the cap is measured against. */
  used: number;
};

const MODES: { key: PurchaseBudgetCapMode; label: string; amountLabel: string }[] = [
  { key: "add", label: "เพิ่มเพดาน", amountLabel: "เพิ่มเพดาน (บาท)" },
  { key: "subtract", label: "ลดเพดาน", amountLabel: "ลดเพดาน (บาท)" },
  { key: "set", label: "กำหนดค่าใหม่", amountLabel: "เพดานใหม่ (บาท)" },
];

const REASON_MAX_LENGTH = 500;
const inputCls =
  "h-11 w-full rounded-lg border border-gray-300 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100";
const statBoxCls = "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/10 dark:bg-white/5";

const parseAmount = (text: string): number => Number(text.replace(/,/g, "").trim());

const CurrentStats = ({ cap, used }: { cap: number | null; used: number }) => (
  <div className="mt-4 grid grid-cols-2 gap-2.5">
    <div className={statBoxCls}>
      <p className="text-xs text-gray-500 dark:text-slate-400">เพดานปัจจุบัน</p>
      <p className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">{cap === null ? "ยังไม่ได้ตั้ง" : formatBaht(cap)}</p>
    </div>
    <div className={statBoxCls}>
      <p className="text-xs text-gray-500 dark:text-slate-400">{cap === null ? "มูลค่าที่ใช้อยู่ตอนนี้" : "งบคงเหลือตอนนี้"}</p>
      <p className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">{formatBaht(cap === null ? used : cap - used)}</p>
    </div>
  </div>
);

const ModeSwitch = ({ mode, onChange }: { mode: PurchaseBudgetCapMode; onChange: (mode: PurchaseBudgetCapMode) => void }) => (
  <div role="group" aria-label="วิธีปรับเพดาน" className="mt-4 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-white/10 dark:bg-white/5">
    {MODES.map((item) => (
      <button key={item.key} type="button" aria-pressed={mode === item.key} onClick={() => onChange(item.key)}
        className={`min-h-10 flex-1 rounded-md text-sm font-semibold transition ${mode === item.key
          ? "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
          : "text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"}`}>
        {item.label}
      </button>
    ))}
  </div>
);

const Preview = ({ cap, used, newCap }: { cap: number | null; used: number; newCap: number | null }) => {
  const newRemaining = newCap === null ? null : newCap - used;
  const negative = newRemaining !== null && newRemaining < 0;
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm dark:border-white/10 dark:bg-white/5">
      <p className="text-xs font-semibold text-gray-500 dark:text-slate-400">ผลหลังบันทึก</p>
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="text-gray-600 dark:text-slate-300">เพดาน</span>
        <span className="whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">
          {cap === null ? "—" : formatBaht(cap)} → <strong>{newCap === null ? "—" : formatBaht(newCap)}</strong>
        </span>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="text-gray-600 dark:text-slate-300">งบคงเหลือ</span>
        <span className="whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">
          {cap === null ? "—" : formatBaht(cap - used)} →{" "}
          <strong className={negative ? "text-rose-700 dark:text-rose-300" : ""}>{newRemaining === null ? "—" : formatBaht(newRemaining)}</strong>
        </span>
      </div>
      {negative ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">เพดานใหม่ต่ำกว่ามูลค่าที่ใช้ไปแล้ว งบจะติดลบ — บันทึกได้ แต่การ์ดจะขึ้นสถานะ “เกินงบ”</p>
      ) : null}
    </div>
  );
};

const validationHint = (amount: number, thresholdText: string, reason: string): string => {
  const threshold = Number(thresholdText.trim());
  if (!(Number.isFinite(amount) && amount > 0)) return "กรอกจำนวนเงินที่มากกว่า 0";
  if (thresholdText.trim() === "" || !Number.isFinite(threshold) || threshold < 0 || threshold > PURCHASE_BUDGET_MAX_THRESHOLD_PCT) {
    return `เส้นเตือนต้องอยู่ระหว่าง 0–${PURCHASE_BUDGET_MAX_THRESHOLD_PCT}%`;
  }
  return reason.trim() ? "" : "กรอกเหตุผลก่อนบันทึก";
};

const PurchaseBudgetCapDialog = ({ variant, cap, thresholdPct, used }: PurchaseBudgetCapDialogProps) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PurchaseBudgetCapMode>(variant === "setup" ? "set" : "add");
  const [amountText, setAmountText] = useState("");
  const [thresholdText, setThresholdText] = useState(String(thresholdPct));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [pending, startTransition] = useTransition();

  const amount = parseAmount(amountText);
  const hint = validationHint(amount, thresholdText, reason);
  const newCap = Number.isFinite(amount) && amount > 0 ? applyPurchaseBudgetCapChange(cap, mode, amount) : null;

  const openDialog = () => {
    setError(""); setSavedNote(""); setAmountText(""); setReason("");
    setThresholdText(String(thresholdPct));
    setMode(variant === "setup" ? "set" : "add");
    setOpen(true);
  };
  const close = () => { if (!pending) setOpen(false); };

  const save = () => {
    if (hint) { setError(hint); return; }
    setError("");
    const formData = new FormData();
    formData.set("mode", mode);
    formData.set("amount", String(amount));
    formData.set("thresholdPct", thresholdText.trim());
    formData.set("reason", reason.trim());
    startTransition(async () => {
      try {
        const result = await updatePurchaseBudgetCap(formData);
        if (result.error || result.cap === undefined) { setError(result.error ?? "บันทึกเพดานงบไม่สำเร็จ"); return; }
        setOpen(false);
        setSavedNote(`บันทึกเพดานใหม่ ${formatBaht(result.cap)} บาทแล้ว · เก็บประวัติใน Audit log`);
        router.refresh();
      } catch {
        setError("บันทึกเพดานงบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    });
  };

  return (
    <>
      <button type="button" onClick={openDialog}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#163055] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400">
        <Pencil size={15} aria-hidden /> {variant === "setup" ? "ตั้งเพดานงบ" : "ปรับเพดานงบ"}
      </button>
      {savedNote ? <p role="status" className="basis-full text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">{savedNote}</p> : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="purchase-budget-cap-title"
          onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6 dark:border dark:border-white/10 dark:bg-[#101b2e]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="purchase-budget-cap-title" className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
                  {variant === "setup" ? "ตั้งเพดานงบสั่งซื้อ" : "ปรับเพดานงบสั่งซื้อ"}
                </h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">ใช้ได้เฉพาะผู้มีสิทธิ์ “ปรับเพดานงบสั่งซื้อ”</p>
              </div>
              <button type="button" onClick={close} aria-label="ปิด" disabled={pending}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-white/20 dark:text-slate-300 dark:hover:bg-white/5">
                <X size={18} aria-hidden />
              </button>
            </div>
            <CurrentStats cap={cap} used={used} />
            {variant === "adjust" ? <ModeSwitch mode={mode} onChange={setMode} /> : null}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">
                  {MODES.find((item) => item.key === mode)?.amountLabel}
                </span>
                <input type="text" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} className={inputCls} autoFocus />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">เส้นเตือน (%)</span>
                <input type="text" inputMode="decimal" value={thresholdText} onChange={(event) => setThresholdText(event.target.value)} className={inputCls} />
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">แจ้งเตือนผ่านกระดิ่งและ Telegram เมื่องบเหลือต่ำกว่าเส้นเตือน (% ของเพดาน) และเมื่อเกินเพดาน</p>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">เหตุผล <span className="text-red-500">*</span></span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={REASON_MAX_LENGTH}
                placeholder="เช่น เตรียมสต็อกช่วงปลายปี"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500" />
            </label>
            <Preview cap={cap} used={used} newCap={newCap} />
            <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">ทุกครั้งที่บันทึก ระบบเก็บประวัติใน Audit log: ผู้แก้ เวลา ค่าเดิม → ค่าใหม่ และเหตุผล</p>
            {error ? (
              <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              {hint && !error ? <span className="mr-auto text-xs text-gray-500 dark:text-slate-400">{hint}</span> : null}
              <button type="button" onClick={close} disabled={pending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:text-slate-300 dark:hover:bg-white/5">ยกเลิก</button>
              <button type="button" onClick={save} disabled={pending || Boolean(hint)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400">
                {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} บันทึกเพดาน
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default PurchaseBudgetCapDialog;
