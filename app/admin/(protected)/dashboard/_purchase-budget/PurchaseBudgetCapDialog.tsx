"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";

import {
  applyPurchaseBudgetChange,
  PURCHASE_BUDGET_MAX_THRESHOLD_PCT,
  roundBaht,
  type PurchaseBudgetChangeMode,
} from "@/lib/purchase-budget-core";
import { formatDateThai, getThailandDateKey, isDateOnlyString, parseDateOnlyToStartOfDay } from "@/lib/th-date";

import { updatePurchaseBudget } from "../purchase-budget-actions";
import { formatBaht } from "@/components/shared/purchase-budget-ui";

type PurchaseBudgetCapDialogProps = {
  /** "setup" = no budget yet: only a start (amount + start date) is offered. */
  variant: "setup" | "adjust";
  budget: number | null;
  thresholdPct: number;
  /** Current remaining budget; null while none is set. */
  remaining: number | null;
};

const MODES: { key: PurchaseBudgetChangeMode; label: string; amountLabel: string }[] = [
  { key: "add", label: "เพิ่มงบ", amountLabel: "เพิ่มงบ (บาท)" },
  { key: "subtract", label: "ลดงบ", amountLabel: "ลดงบ (บาท)" },
  { key: "restart", label: "เริ่มรอบใหม่", amountLabel: "งบรอบใหม่ (บาท)" },
];

const REASON_MAX_LENGTH = 500;
const START_DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const inputCls =
  "h-11 w-full rounded-lg border border-gray-300 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100";
const statBoxCls = "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/10 dark:bg-white/5";

const parseAmount = (text: string): number => Number(text.replace(/,/g, "").trim());

const CurrentStats = ({ budget, remaining }: { budget: number | null; remaining: number | null }) => (
  <div className="mt-4 grid grid-cols-2 gap-2.5">
    <div className={statBoxCls}>
      <p className="text-xs text-gray-500 dark:text-slate-400">งบที่ตั้ง</p>
      <p className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">{budget === null ? "ยังไม่ได้ตั้ง" : formatBaht(budget)}</p>
    </div>
    <div className={statBoxCls}>
      <p className="text-xs text-gray-500 dark:text-slate-400">งบคงเหลือตอนนี้</p>
      <p className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">{remaining === null ? "—" : formatBaht(remaining)}</p>
    </div>
  </div>
);

const ModeSwitch = ({ mode, onChange }: { mode: PurchaseBudgetChangeMode; onChange: (mode: PurchaseBudgetChangeMode) => void }) => (
  <div role="group" aria-label="วิธีปรับงบ" className="mt-4 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-white/10 dark:bg-white/5">
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

const previewBoxCls = "mt-3 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm dark:border-white/10 dark:bg-white/5";

const PreviewRow = ({ label, from, to, negative = false }: { label: string; from: string; to: string; negative?: boolean }) => (
  <div className="flex flex-wrap justify-between gap-x-3">
    <span className="text-gray-600 dark:text-slate-300">{label}</span>
    <span className="whitespace-nowrap tabular-nums text-gray-900 dark:text-slate-100">
      {from} → <strong className={negative ? "text-rose-700 dark:text-rose-300" : ""}>{to}</strong>
    </span>
  </div>
);

/** Top-up / cut: the remaining budget moves by the same amount as the budget set. */
const AdjustPreview = ({ budget, remaining, newBudget }: { budget: number; remaining: number; newBudget: number | null }) => {
  const newRemaining = newBudget === null ? null : roundBaht(remaining + newBudget - budget);
  const negative = newRemaining !== null && newRemaining < 0;
  return (
    <div className={previewBoxCls}>
      <p className="text-xs font-semibold text-gray-500 dark:text-slate-400">ผลหลังบันทึก</p>
      <PreviewRow label="งบที่ตั้ง" from={formatBaht(budget)} to={newBudget === null ? "—" : formatBaht(newBudget)} />
      <PreviewRow label="งบคงเหลือ" from={formatBaht(remaining)} to={newRemaining === null ? "—" : formatBaht(newRemaining)} negative={negative} />
      {negative ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">งบคงเหลือจะติดลบ — บันทึกได้ แต่การ์ดจะขึ้นสถานะ “เกินงบ”</p>
      ) : null}
    </div>
  );
};

/** Start / new round: the remaining budget is re-counted from the documents dated from the start date. */
const RestartPreview = ({ newBudget, startDate, replacing }: { newBudget: number | null; startDate: string; replacing: boolean }) => (
  <div className={previewBoxCls}>
    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400">ผลหลังบันทึก</p>
    {replacing ? (
      <p className="text-xs text-amber-700 dark:text-amber-300">รอบเดิมจะจบลง: งบที่ตั้งและยอดเพิ่ม/ลดงบเดิมถูกแทนด้วยงบรอบใหม่</p>
    ) : null}
    <p className="text-gray-900 dark:text-slate-100">
      งบ <strong className="tabular-nums">{newBudget === null ? "—" : formatBaht(newBudget)}</strong> บาท
      {isDateOnlyString(startDate) ? <> เริ่มนับเอกสารที่ลงวันที่ตั้งแต่ <strong>{formatDateThai(parseDateOnlyToStartOfDay(startDate), START_DATE_FORMAT)}</strong></> : null}
    </p>
    <p className="text-xs text-gray-500 dark:text-slate-400">
      งบคงเหลือคำนวณใหม่จากใบซื้อ บิลขาย และรายการสต็อกที่ลงวันที่ตั้งแต่วันเริ่มนับ เอกสารก่อนหน้านั้นไม่นับ
    </p>
  </div>
);

const validationHint = (input: {
  amount: number;
  newBudget: number | null;
  restart: boolean;
  startDate: string;
  thresholdText: string;
  reason: string;
}): string => {
  const threshold = Number(input.thresholdText.trim());
  if (!(Number.isFinite(input.amount) && input.amount > 0)) return "กรอกจำนวนเงินที่มากกว่า 0";
  if (input.newBudget === null || input.newBudget <= 0) return "งบหลังปรับต้องมากกว่า 0 บาท";
  if (input.restart && !isDateOnlyString(input.startDate)) return "เลือกวันที่เริ่มนับ";
  if (input.restart && input.startDate > getThailandDateKey()) return "วันที่เริ่มนับต้องไม่เกินวันนี้";
  if (input.thresholdText.trim() === "" || !Number.isFinite(threshold) || threshold < 0 || threshold > PURCHASE_BUDGET_MAX_THRESHOLD_PCT) {
    return `เส้นเตือนต้องอยู่ระหว่าง 0–${PURCHASE_BUDGET_MAX_THRESHOLD_PCT}%`;
  }
  return input.reason.trim() ? "" : "กรอกเหตุผลก่อนบันทึก";
};

const PurchaseBudgetCapDialog = ({ variant, budget, thresholdPct, remaining }: PurchaseBudgetCapDialogProps) => {
  const router = useRouter();
  const initialMode: PurchaseBudgetChangeMode = variant === "setup" ? "restart" : "add";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PurchaseBudgetChangeMode>(initialMode);
  const [amountText, setAmountText] = useState("");
  const [startDate, setStartDate] = useState("");
  const [thresholdText, setThresholdText] = useState(String(thresholdPct));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [pending, startTransition] = useTransition();

  const amount = parseAmount(amountText);
  const restart = mode === "restart";
  const newBudget = Number.isFinite(amount) && amount > 0 ? applyPurchaseBudgetChange(budget, mode, amount) : null;
  const hint = validationHint({ amount, newBudget, restart, startDate, thresholdText, reason });

  const openDialog = () => {
    setError(""); setSavedNote(""); setAmountText(""); setReason("");
    setStartDate(getThailandDateKey());
    setThresholdText(String(thresholdPct));
    setMode(initialMode);
    setOpen(true);
  };
  const close = () => { if (!pending) setOpen(false); };

  const save = () => {
    if (hint) { setError(hint); return; }
    setError("");
    const formData = new FormData();
    formData.set("mode", mode);
    formData.set("amount", String(amount));
    if (restart) formData.set("startDate", startDate);
    formData.set("thresholdPct", thresholdText.trim());
    formData.set("reason", reason.trim());
    startTransition(async () => {
      try {
        const result = await updatePurchaseBudget(formData);
        if (result.error || result.budget === undefined) { setError(result.error ?? "บันทึกงบไม่สำเร็จ"); return; }
        setOpen(false);
        setSavedNote(`บันทึกแล้ว · งบที่ตั้ง ${formatBaht(result.budget)} บาท · เก็บประวัติใน Audit log`);
        router.refresh();
      } catch {
        setError("บันทึกงบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    });
  };

  return (
    <>
      <button type="button" onClick={openDialog}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#163055] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400">
        <Pencil size={15} aria-hidden /> {variant === "setup" ? "ตั้งงบ" : "ปรับงบ"}
      </button>
      {savedNote ? <p role="status" className="basis-full text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">{savedNote}</p> : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="purchase-budget-cap-title"
          onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6 dark:border dark:border-white/10 dark:bg-[#101b2e]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="purchase-budget-cap-title" className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
                  {variant === "setup" ? "ตั้งงบสั่งซื้อ" : "ปรับงบสั่งซื้อ"}
                </h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">ใช้ได้เฉพาะผู้มีสิทธิ์ “ปรับงบสั่งซื้อ”</p>
              </div>
              <button type="button" onClick={close} aria-label="ปิด" disabled={pending}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-white/20 dark:text-slate-300 dark:hover:bg-white/5">
                <X size={18} aria-hidden />
              </button>
            </div>
            <CurrentStats budget={budget} remaining={remaining} />
            {variant === "adjust" ? <ModeSwitch mode={mode} onChange={setMode} /> : null}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">
                  {variant === "setup" ? "งบที่ตั้ง (บาท)" : MODES.find((item) => item.key === mode)?.amountLabel}
                </span>
                <input type="text" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} className={inputCls} autoFocus />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">เส้นเตือน (%)</span>
                <input type="text" inputMode="decimal" value={thresholdText} onChange={(event) => setThresholdText(event.target.value)} className={inputCls} />
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">แจ้งเตือนผ่านกระดิ่งและ Telegram เมื่องบเหลือต่ำกว่าเส้นเตือน (% ของงบที่ตั้ง) และเมื่องบติดลบ</p>
            {restart ? (
              <label className="mt-3 block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">เริ่มนับเอกสารตั้งแต่วันที่</span>
                <input type="date" value={startDate} max={getThailandDateKey()} onChange={(event) => setStartDate(event.target.value)} className={inputCls} />
                <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">เอกสารที่ลงวันที่ก่อนวันนี้ไม่นับ แม้คีย์เข้าระบบภายหลัง</span>
              </label>
            ) : null}
            <label className="mt-3 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">เหตุผล <span className="text-red-500">*</span></span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={REASON_MAX_LENGTH}
                placeholder="เช่น เตรียมสต็อกช่วงปลายปี"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500" />
            </label>
            {restart ? (
              <RestartPreview newBudget={newBudget} startDate={startDate} replacing={budget !== null} />
            ) : budget !== null && remaining !== null ? (
              <AdjustPreview budget={budget} remaining={remaining} newBudget={newBudget} />
            ) : null}
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
                {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} บันทึกงบ
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default PurchaseBudgetCapDialog;
