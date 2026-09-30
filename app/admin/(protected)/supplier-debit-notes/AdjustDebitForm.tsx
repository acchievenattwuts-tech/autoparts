"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Calculator, Info, Loader2, Lock, Save } from "lucide-react";
import { getThailandDateKey } from "@/lib/th-date";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import type { CashBankAccountOption } from "@/lib/cash-bank-accounts";
import { createDebitAdjustment, previewDebitAdjustment } from "./actions";
import PeriodLockOverrideField, { isPeriodLockReasonValid } from "./PeriodLockOverrideField";

type VatType = "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT";
type AmountMode = "PER_UNIT" | "TOTAL";
type Direction = "INCREASE" | "DECREASE";
type ExcessType = "SUPPLIER_CREDIT" | "CASH_REFUND";
/**
 * The parent DN as the adjustment form needs it; chargedNet = parent line net + its ACTIVE adjustments on that line.
 * V3: the adjustment inherits the parent's VAT type, rate and stored recoverability (the server rejects any other).
 */
export type AdjustParentView = {
  id: string; debitNo: string; purchaseNo: string; supplierName: string; netAmount: number; adjustedNet: number;
  amountRemain: number; dueDate: string; vatType: VatType; vatRate: number; vatRecoverable: boolean;
  lines: Array<{ purchaseItemId: string; productName: string; productCode: string; unitName: string; affectedQuantity: number;
    amountMode: AmountMode; increaseAmount: number; chargedNet: number }>;
};
type Preview = NonNullable<Awaited<ReturnType<typeof previewDebitAdjustment>>["preview"]>;
type LineState = { purchaseItemId: string; selected: boolean; affectedQuantity: number; amountMode: AmountMode; amount: number };

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:disabled:bg-white/5 dark:disabled:text-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";
const cardCls = "rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]";
const headingCls = "font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-300";
const thCls = "py-2 px-2 font-medium text-gray-500 dark:text-slate-400";
const money = (value: number): string => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const VAT_OPTIONS: Array<{ value: VatType; label: string }> = [
  { value: "NO_VAT", label: "ไม่มี VAT" }, { value: "EXCLUDING_VAT", label: "ไม่รวม VAT" }, { value: "INCLUDING_VAT", label: "รวม VAT" },
];
const DIRECTION_OPTIONS: Array<{ value: Direction; label: string; hint: string }> = [
  { value: "DECREASE", label: "ลดยอด", hint: "ซัพพลายเออร์ลดราคาให้" },
  { value: "INCREASE", label: "เพิ่มยอด", hint: "ซัพพลายเออร์เรียกเก็บเพิ่ม" },
];

/** The parent's stored VAT treatment, which the adjustment inherits (V3). */
const inheritedVatText = (parent: AdjustParentView): string => {
  if (parent.vatType === "NO_VAT") return "ไม่มี VAT แยก: ยอดทั้งหมดเป็นต้นทุน";
  return parent.vatRecoverable ? "VAT เป็นภาษีซื้อ ไม่รวมในต้นทุน" : "VAT รวมเป็นต้นทุนทั้งจำนวน";
};

const SummaryRow = ({ label, value, tone = "" }: { label: string; value: string; tone?: string }) => (
  <div className={`flex justify-between gap-6 ${tone || "text-gray-600 dark:text-slate-400"}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>
);

const AdjustmentSummary = ({ preview }: { preview: Preview | null }) => {
  if (!preview) return <p className="text-sm text-gray-500 dark:text-slate-400">กด “ตรวจยอด” เพื่อคำนวณยอด การจัดสรรต้นทุน และผลต่อยอดค้างของ DN เดิมก่อนบันทึก</p>;
  const decrease = preview.direction === "DECREASE";
  return (
    <div className="w-full space-y-2 text-sm sm:w-80">
      <SummaryRow label="ยอดก่อน VAT" value={money(preview.subtotalAmount)} />
      <SummaryRow label="VAT" value={money(preview.vatAmount)} />
      <div className="border-t border-gray-100 pt-2 font-semibold dark:border-white/10">
        <SummaryRow label={decrease ? "เจ้าหนี้ลด" : "เจ้าหนี้เพิ่ม (เอกสารแยกใบ)"} value={money(preview.netAmount)} tone="text-gray-900 dark:text-slate-100" />
      </div>
      <SummaryRow label={decrease ? "ลดมูลค่าสต็อก" : "เพิ่มมูลค่าสต็อก"} value={money(preview.inventoryAmount)} tone="text-emerald-700 dark:text-emerald-400" />
      <SummaryRow label="ส่วนต่างต้นทุนงวดนี้" value={money(preview.varianceAmount)} tone="text-amber-700 dark:text-amber-400" />
      {decrease ? (
        <div className="space-y-2 border-t border-gray-100 pt-2 dark:border-white/10">
          <SummaryRow label="ยอดค้างของ DN เดิมตอนนี้" value={money(preview.parentRemain)} />
          <SummaryRow label="หักยอดค้างของ DN เดิม" value={money(preview.appliedToParent)} tone="text-teal-700 dark:text-teal-300" />
          <SummaryRow label="ส่วนที่ลดเกินยอดค้าง" value={money(preview.excessAmount)} tone="text-teal-700 dark:text-teal-300" />
        </div>
      ) : null}
    </div>
  );
};

/** ก3: how the excess of a reduction is settled; shown only when the preview found an excess. */
const ExcessSettlementField = ({ excess, type, onType, accountId, onAccount, accounts, disabled }: {
  excess: number; type: ExcessType | ""; onType: (value: ExcessType) => void; accountId: string; onAccount: (value: string) => void;
  accounts: CashBankAccountOption[]; disabled: boolean;
}) => {
  const options: SelectOption[] = accounts.map((account) => ({ id: account.id, label: account.name,
    sublabel: [account.code, account.type === "BANK" ? account.bankName ?? "ธนาคาร" : "เงินสด", account.accountNo].filter(Boolean).join(" | ") }));
  const choice = (value: ExcessType, title: string, hint: string) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${type === value
      ? "border-teal-400 bg-teal-50 dark:border-teal-400/50 dark:bg-teal-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"}`}>
      <input type="radio" name="excessSettlementType" className="mt-1 accent-teal-600" checked={type === value} disabled={disabled} onChange={() => onType(value)} />
      <span><span className="block font-medium text-gray-900 dark:text-slate-100">{title}</span><span className="text-gray-500 dark:text-slate-400">{hint}</span></span>
    </label>
  );
  return (
    <section className={cardCls}>
      <h2 className={`${headingCls} mb-1`}>ส่วนที่ลดเกินยอดค้าง {money(excess)} บาท</h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-slate-400">DN เดิมจ่ายไปแล้วบางส่วนหรือทั้งหมด เลือกวิธีรับยอดส่วนเกินคืนจากซัพพลายเออร์</p>
      <div className="grid gap-3 md:grid-cols-2">
        {choice("SUPPLIER_CREDIT", "เก็บเป็นเครดิตซัพพลายเออร์", "นำไปหักตอนจ่ายชำระครั้งถัดไปได้ เหมือนเครดิตใบคืนซื้อ")}
        {choice("CASH_REFUND", "รับเงินคืนเข้าบัญชี", "บันทึกเงินเข้าบัญชีเงินสด/ธนาคารวันนี้")}
      </div>
      {type === "CASH_REFUND" ? (
        <div className="mt-4 max-w-md">
          <span className={labelCls}>บัญชีที่รับเงินคืน <span className="text-red-500">*</span></span>
          <SearchableSelect options={options} value={accountId} onChange={onAccount} placeholder="เลือกบัญชีเงินสด/ธนาคาร" disabled={disabled} />
        </div>
      ) : null}
    </section>
  );
};

const AdjustDebitForm = ({ parent, cashBankAccounts, canOverride }: {
  parent: AdjustParentView; cashBankAccounts: CashBankAccountOption[]; canOverride: boolean;
}) => {
  const router = useRouter();
  const today = getThailandDateKey();
  const [pending, startTransition] = useTransition();
  const [direction, setDirection] = useState<Direction>("DECREASE");
  const [header, setHeader] = useState({ supplierReferenceNo: "", debitDate: today, receivedDate: today, dueDate: parent.dueDate, reason: "", note: "" });
  const vat = { vatType: parent.vatType, vatRate: parent.vatRate };
  const [lines, setLines] = useState<LineState[]>(() => parent.lines.map((line) => ({ purchaseItemId: line.purchaseItemId,
    selected: false, affectedQuantity: line.affectedQuantity, amountMode: line.amountMode, amount: 0 })));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [excessType, setExcessType] = useState<ExcessType | "">("");
  const [accountId, setAccountId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState("");
  const sign = direction === "DECREASE" ? -1 : 1;
  const lockPeriods = preview?.lockedPeriods ?? [];
  const excess = preview?.direction === "DECREASE" ? preview.excessAmount : 0;
  const settlementMissing = excess > 0 && (!excessType || (excessType === "CASH_REFUND" && !accountId));
  const overrideMissing = lockPeriods.length > 0 && canOverride && !isPeriodLockReasonValid(overrideReason);
  const lockBlocksSave = lockPeriods.length > 0 && !canOverride;

  const invalidate = () => { setPreview(null); };
  const changeLine = (index: number, next: Partial<LineState>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...next } : line))); invalidate();
  };
  const payload = () => ({ parentId: parent.id, ...header, dueDate: direction === "DECREASE" ? header.receivedDate : header.dueDate, ...vat,
    items: lines.filter((line) => line.selected).map((line) => ({ purchaseItemId: line.purchaseItemId,
      affectedQuantity: line.affectedQuantity, amountMode: line.amountMode, increaseAmount: sign * Math.abs(line.amount) })),
    ...(excess > 0 && excessType ? { excessSettlementType: excessType } : {}),
    ...(excess > 0 && excessType === "CASH_REFUND" && accountId ? { cashBankAccountId: accountId } : {}),
    expectedInventoryAmount: preview?.inventoryAmount, expectedVarianceAmount: preview?.varianceAmount,
    expectedExcessAmount: preview ? excess : undefined });
  const validate = (): string => {
    if (!header.supplierReferenceNo.trim()) return "กรุณาระบุเลขที่เอกสารของซัพพลายเออร์";
    if (!header.reason.trim()) return "กรุณาระบุเหตุผลปรับยอด";
    const selected = lines.filter((line) => line.selected);
    if (selected.length === 0) return "กรุณาเลือกรายการที่ปรับยอดอย่างน้อย 1 รายการ";
    if (selected.some((line) => !(line.affectedQuantity > 0) || !(line.amount > 0))) return "รายการที่เลือกต้องมีจำนวนและส่วนต่างมากกว่า 0";
    return "";
  };
  const run = (task: () => Promise<void>, fallback: string) => {
    const draftError = validate();
    if (draftError) { setError(draftError); return; }
    setError("");
    startTransition(async () => { try { await task(); } catch { setError(fallback); } });
  };
  const check = () => run(async () => {
    const result = await previewDebitAdjustment(payload());
    setError(result.error ?? ""); setPreview(result.preview ?? null);
  }, "ตรวจยอดไม่สำเร็จ กรุณาลองใหม่");
  const save = () => run(async () => {
    const result = await createDebitAdjustment(payload(), canOverride && overrideReason.trim() ? overrideReason : undefined);
    if (result.id) { router.push(`/admin/supplier-debit-notes/${result.id}?created=1`); router.refresh(); return; }
    setError(result.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    if (result.previewRequired) setPreview(null);
  }, "บันทึกไม่สำเร็จ กรุณาลองใหม่");

  return (
    <div className="space-y-6">
      <section className={cardCls}>
        <div className="mb-5 grid gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4 dark:bg-white/5">
          <div><p className="text-gray-500 dark:text-slate-400">DN ต้นทาง / ใบซื้อ</p><p className="mt-0.5 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{parent.debitNo} · {parent.purchaseNo}</p></div>
          <div><p className="text-gray-500 dark:text-slate-400">ซัพพลายเออร์</p><p className="mt-0.5 font-medium text-gray-900 dark:text-slate-100">{parent.supplierName}</p></div>
          <div><p className="text-gray-500 dark:text-slate-400">ยอด DN / หลังปรับยอดเดิม</p><p className="mt-0.5 font-medium tabular-nums text-gray-900 dark:text-slate-100">{money(parent.netAmount)} / {money(parent.adjustedNet)}</p></div>
          <div><p className="text-gray-500 dark:text-slate-400">ยอดค้างจ่ายของ DN</p><p className="mt-0.5 font-medium tabular-nums text-gray-900 dark:text-slate-100">{money(parent.amountRemain)}</p></div>
        </div>
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {DIRECTION_OPTIONS.map((option) => (
            <button key={option.value} type="button" disabled={pending} onClick={() => { setDirection(option.value); invalidate(); }}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${direction === option.value
                ? "border-[#1e3a5f] bg-sky-50 text-[#1e3a5f] dark:border-sky-400 dark:bg-sky-500/15 dark:text-sky-200"
                : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"}`}>
              {option.value === "DECREASE" ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
              <span><span className="block font-semibold">{option.label}</span><span className="text-xs opacity-80">{option.hint}</span></span>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block"><span className={labelCls}>เลขที่เอกสารของซัพพลายเออร์ <span className="text-red-500">*</span></span>
            <input className={inputCls} value={header.supplierReferenceNo} maxLength={100} onChange={(e) => setHeader({ ...header, supplierReferenceNo: e.target.value })} /></label>
          <label className="block"><span className={labelCls}>วันที่ออกเอกสาร</span>
            <input type="date" className={inputCls} value={header.debitDate} max={today} onChange={(e) => setHeader({ ...header, debitDate: e.target.value })} /></label>
          <label className="block"><span className={labelCls}>วันที่ได้รับ (นับอายุเจ้าหนี้)</span>
            <input type="date" className={inputCls} value={header.receivedDate} max={today} onChange={(e) => setHeader({ ...header, receivedDate: e.target.value })} /></label>
          {direction === "INCREASE" ? (
            <label className="block"><span className={labelCls}>วันครบกำหนดชำระ</span>
              <input type="date" className={inputCls} value={header.dueDate} onChange={(e) => setHeader({ ...header, dueDate: e.target.value })} /></label>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block"><span className={labelCls}>เหตุผลปรับยอด <span className="text-red-500">*</span></span>
            <input className={inputCls} value={header.reason} maxLength={1000} placeholder="เช่น ซัพพลายเออร์ลดราคาหลังตรวจสอบ" onChange={(e) => setHeader({ ...header, reason: e.target.value })} /></label>
          <label className="block"><span className={labelCls}>หมายเหตุ</span>
            <textarea rows={1} className={`${inputCls} resize-y`} value={header.note} maxLength={2000} onChange={(e) => setHeader({ ...header, note: e.target.value })} /></label>
        </div>
      </section>

      <section className={cardCls}>
        <h2 className={`${headingCls} mb-5 border-b border-gray-100 pb-3 dark:border-white/10`}>รายการที่ปรับยอด (อ้างอิงรายการของ DN เดิม)</h2>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <label className="block"><span className={labelCls}>ราคาส่วนต่าง</span>
            <select className={inputCls} value={vat.vatType} disabled aria-readonly="true">
              {VAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block"><span className={labelCls}>อัตรา VAT (%)</span>
            <input type="number" className={inputCls} value={vat.vatRate} disabled readOnly /></label>
          <p className="flex items-start gap-2 self-end rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>ใช้ VAT ตาม DN ต้นทาง {parent.debitNo} (แก้ไม่ได้) · {inheritedVatText(parent)}</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-white/10">
              <th className={`${thCls} w-10 text-center`}>เลือก</th><th className={`${thCls} text-left`}>สินค้า</th>
              <th className={`${thCls} w-32 text-right`}>ยอด DN คงเหลือ</th><th className={`${thCls} w-32 text-left`}>จำนวนที่ปรับ</th>
              <th className={`${thCls} w-40 text-left`}>วิธีกรอก</th><th className={`${thCls} w-36 text-left`}>{direction === "DECREASE" ? "ส่วนต่างที่ลด" : "ส่วนต่างที่เพิ่ม"}</th>
            </tr></thead>
            <tbody>{parent.lines.map((source, index) => {
              const line = lines[index];
              return (
                <tr key={source.purchaseItemId} className={`border-b border-gray-100 dark:border-white/5 ${line.selected ? "bg-sky-50/60 dark:bg-sky-500/10" : ""}`}>
                  <td className="px-2 py-2 text-center"><input type="checkbox" aria-label={`เลือก ${source.productName}`} checked={line.selected}
                    className="h-4 w-4 rounded border-gray-300 accent-[#1e3a5f] dark:border-white/20 dark:accent-sky-500" onChange={(e) => changeLine(index, { selected: e.target.checked })} /></td>
                  <td className="px-2 py-2"><p className="font-medium text-gray-900 dark:text-slate-100">{source.productName}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400"><span className="font-mono">{source.productCode}</span> · DN เดิม {money(source.increaseAmount)} {source.amountMode === "TOTAL" ? "ยอดรวม" : `ต่อ ${source.unitName}`}</p></td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-700 dark:text-slate-300">{money(source.chargedNet)}</td>
                  <td className="px-2 py-2"><input aria-label={`จำนวน ${source.productCode}`} type="number" className={inputCls} min={0} step="0.0001"
                    value={line.affectedQuantity} disabled={!line.selected} onChange={(e) => changeLine(index, { affectedQuantity: Number(e.target.value) })} /></td>
                  <td className="px-2 py-2"><select aria-label={`วิธีกรอก ${source.productCode}`} className={inputCls} value={line.amountMode} disabled={!line.selected}
                    onChange={(e) => changeLine(index, { amountMode: e.target.value === "TOTAL" ? "TOTAL" : "PER_UNIT" })}>
                    <option value="PER_UNIT">ต่อ {source.unitName}</option><option value="TOTAL">ยอดรวมของรายการ</option></select></td>
                  <td className="px-2 py-2"><input aria-label={`ส่วนต่าง ${source.productCode}`} type="number" className={inputCls} min={0} step="0.01"
                    value={line.amount} disabled={!line.selected} onChange={(e) => changeLine(index, { amount: Math.abs(Number(e.target.value)) })} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="mt-5 flex justify-end border-t border-gray-100 pt-4 dark:border-white/10"><AdjustmentSummary preview={preview} /></div>
      </section>

      {excess > 0 ? <ExcessSettlementField excess={excess} type={excessType} onType={setExcessType} accountId={accountId}
        onAccount={setAccountId} accounts={cashBankAccounts} disabled={pending} /> : null}

      {lockPeriods.length > 0 ? (canOverride
        ? <PeriodLockOverrideField periods={lockPeriods} value={overrideReason} onChange={setOverrideReason} disabled={pending} />
        : <p role="alert" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          <Lock size={16} className="mt-0.5 shrink-0" /> บันทึกไม่ได้: เดือนปัจจุบันประกาศปันผลแล้ว {lockPeriods.map((period) => `${period.label} (${period.distributionNo})`).join(", ")} · ให้ผู้มีสิทธิ์ปลดล็อกดำเนินการ</p>) : null}

      {error ? (
        <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-500 dark:text-slate-400">ลงต้นทุนวันนี้ {today} · ต้องตรวจยอดก่อนบันทึกทุกครั้งที่เปลี่ยนทิศทาง รายการ หรือยอด</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/admin/supplier-debit-notes/${parent.id}`} className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">ยกเลิก</Link>
          <button type="button" disabled={pending} onClick={check}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-500 dark:hover:text-sky-300">
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />} ตรวจยอด
          </button>
          <button type="button" disabled={pending || !preview || settlementMissing || overrideMissing || lockBlocksSave} onClick={save}
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-600 dark:hover:bg-orange-500">
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} ยืนยันปรับยอด DN
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdjustDebitForm;
