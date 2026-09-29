"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Calculator, Loader2, Lock, Save } from "lucide-react";
import { getThailandDateKey } from "@/lib/th-date";
import { previewDebit, createDebit, updateDebit } from "./actions";

type VatType = "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT";
type AmountMode = "PER_UNIT" | "TOTAL";
export type DebitPurchase = {
  id: string; purchaseNo: string; supplierName: string; vatType: VatType; vatRate: number;
  items: Array<{ id: string; productName: string; productCode: string; quantity: number; unitName: string; price: number }>;
};
export type DebitLineInput = { purchaseItemId: string; affectedQuantity: number; increaseAmount: number; amountMode: AmountMode };
export type DebitFormInitial = {
  id: string; debitNo: string; postingDate: string; supplierReferenceNo: string; debitDate: string; receivedDate: string;
  dueDate: string; reason: string; note: string; vatType: VatType; vatRate: number; vatRecoverable: boolean; items: DebitLineInput[];
};
export type DebitLineLock = { reason: string; links: Array<{ href: string; label: string }> };
type Preview = NonNullable<Awaited<ReturnType<typeof previewDebit>>["preview"]>;
type LineState = DebitLineInput & { selected: boolean };
type VatState = { vatType: VatType; vatRate: number; vatRecoverable: boolean };

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:disabled:bg-white/5 dark:disabled:text-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";
const cardCls = "rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]";
const headingCls = "font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-300";
const checkboxCls = "h-4 w-4 rounded border-gray-300 accent-[#1e3a5f] disabled:cursor-not-allowed dark:border-white/20 dark:accent-sky-500";
const thCls = "py-2 px-2 font-medium text-gray-500 dark:text-slate-400";
const money = (value: number): string => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const VAT_OPTIONS: Array<{ value: VatType; label: string }> = [
  { value: "NO_VAT", label: "ไม่มี VAT" }, { value: "EXCLUDING_VAT", label: "ไม่รวม VAT" }, { value: "INCLUDING_VAT", label: "รวม VAT" },
];

const buildLines = (purchase: DebitPurchase, initial?: DebitFormInitial): LineState[] => purchase.items.map((item) => {
  const posted = initial?.items.find((line) => line.purchaseItemId === item.id);
  return posted ? { ...posted, selected: true }
    : { purchaseItemId: item.id, affectedQuantity: item.quantity, increaseAmount: 0, amountMode: "PER_UNIT", selected: false };
});
const selectedLines = (lines: LineState[]): DebitLineInput[] =>
  lines.filter((line) => line.selected).map(({ purchaseItemId, affectedQuantity, increaseAmount, amountMode }) =>
    ({ purchaseItemId, affectedQuantity, increaseAmount, amountMode }));
const financialKey = (vat: VatState, lines: LineState[]): string => JSON.stringify([vat, selectedLines(lines)]);

const validateDraft = (header: { supplierReferenceNo: string; reason: string }, lines: DebitLineInput[]): string => {
  if (!header.supplierReferenceNo.trim()) return "กรุณาระบุเลข DN ของซัพพลายเออร์";
  if (!header.reason.trim()) return "กรุณาระบุเหตุผลเพิ่มหนี้";
  if (lines.length === 0) return "กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการ";
  if (lines.some((line) => !(line.affectedQuantity > 0) || !(line.increaseAmount > 0))) {
    return "รายการที่เลือกต้องมีจำนวนที่ปรับและส่วนต่างเพิ่มมากกว่า 0";
  }
  return "";
};

const LineLockNotice = ({ lock }: { lock: DebitLineLock }) => (
  <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
    <Lock size={16} className="mt-0.5 shrink-0" />
    <div className="space-y-1">
      <p className="font-medium">แก้ไขได้เฉพาะข้อมูลหัวเอกสาร — รายการ ยอด และ VAT ถูกล็อก</p>
      <p>{lock.reason}</p>
      {lock.links.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {lock.links.map((link) => <Link key={link.href} href={link.href} className="font-medium underline underline-offset-2">{link.label}</Link>)}
        </div>
      ) : null}
    </div>
  </div>
);

const DebitSummary = ({ preview, needsPreview }: { preview: Preview | null; needsPreview: boolean }) => {
  if (!preview) {
    return (
      <p className="text-sm text-gray-500 dark:text-slate-400">
        {needsPreview ? "กด “ตรวจยอด” เพื่อคำนวณยอดเจ้าหนี้และการจัดสรรต้นทุนก่อนบันทึก" : "ยอดและรายการไม่เปลี่ยน บันทึกได้ทันทีโดยไม่กระทบต้นทุน"}
      </p>
    );
  }
  const row = (label: string, value: number, strong = false) => (
    <div className={`flex justify-between ${strong ? "font-semibold text-gray-900 dark:text-slate-100" : "text-gray-600 dark:text-slate-400"}`}>
      <span>{label}</span><span className="tabular-nums">{money(value)}</span>
    </div>
  );
  return (
    <div className="w-full space-y-2 text-sm sm:w-72">
      {row("ยอดก่อน VAT", preview.subtotalAmount)}
      {row("VAT", preview.vatAmount)}
      <div className="border-t border-gray-100 pt-2 dark:border-white/10">{row("เจ้าหนี้เพิ่ม", preview.netAmount, true)}</div>
      <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>เพิ่มมูลค่าสต็อก</span><span className="tabular-nums">{money(preview.inventoryAmount)}</span></div>
      <div className="flex justify-between text-amber-700 dark:text-amber-400"><span>ส่วนต่างต้นทุนงวดนี้</span><span className="tabular-nums">{money(preview.varianceAmount)}</span></div>
    </div>
  );
};

const DebitForm = ({ purchase, initial, lineLock }: { purchase: DebitPurchase; initial?: DebitFormInitial; lineLock?: DebitLineLock | null }) => {
  const router = useRouter();
  const today = getThailandDateKey();
  const isEdit = Boolean(initial);
  const linesLocked = Boolean(initial && lineLock);
  const [pending, startTransition] = useTransition();
  const [header, setHeader] = useState({ supplierReferenceNo: initial?.supplierReferenceNo ?? "", debitDate: initial?.debitDate ?? today,
    receivedDate: initial?.receivedDate ?? today, dueDate: initial?.dueDate ?? today, reason: initial?.reason ?? "", note: initial?.note ?? "" });
  const [vat, setVat] = useState<VatState>({ vatType: initial?.vatType ?? purchase.vatType,
    vatRate: initial?.vatRate ?? purchase.vatRate, vatRecoverable: initial?.vatRecoverable ?? true });
  const [lines, setLines] = useState<LineState[]>(() => buildLines(purchase, initial));
  const [initialKey] = useState(() => financialKey(vat, lines));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const needsPreview = !isEdit || financialKey(vat, lines) !== initialKey;
  const selectedCount = lines.filter((line) => line.selected).length;

  const setHeaderField = (field: keyof typeof header, value: string) => setHeader((current) => ({ ...current, [field]: value }));
  const changeVat = (next: Partial<VatState>) => { setVat((current) => ({ ...current, ...next })); setPreview(null); };
  const changeLine = (index: number, next: Partial<LineState>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...next } : line)));
    setPreview(null);
  };
  const payload = () => ({ purchaseId: purchase.id, ...header, ...vat, items: selectedLines(lines),
    expectedInventoryAmount: preview?.inventoryAmount, expectedVarianceAmount: preview?.varianceAmount });
  const run = (task: () => Promise<void>, fallback: string) => {
    const draftError = validateDraft(header, selectedLines(lines));
    if (draftError) { setError(draftError); return; }
    setError("");
    startTransition(async () => { try { await task(); } catch { setError(fallback); } });
  };
  const check = () => run(async () => {
    const result = await previewDebit(payload());
    setError(result.error ?? ""); setPreview(result.preview ?? null);
  }, "ตรวจยอดไม่สำเร็จ กรุณาลองใหม่");
  const save = () => run(async () => {
    if (initial) {
      const result = await updateDebit(initial.id, payload());
      if (result.error) { setError(result.error); setPreview(null); return; }
      router.push(`/admin/supplier-debit-notes/${initial.id}?updated=1`); router.refresh(); return;
    }
    const result = await createDebit(payload());
    if (result.id && result.debitNo) { router.push(`/admin/supplier-debit-notes/${result.id}?created=1`); router.refresh(); return; }
    setError(result.error ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่"); setPreview(null);
  }, "บันทึกไม่สำเร็จ กรุณาลองใหม่");

  const postingNote = !needsPreview && initial ? `คงวันที่ลงต้นทุนเดิม ${initial.postingDate}`
    : `ลงต้นทุนวันนี้ ${today} โดยไม่รับจำนวนสินค้าเพิ่ม`;

  return (
    <div className="space-y-6">
      {linesLocked && lineLock ? <LineLockNotice lock={lineLock} /> : null}

      <section className={cardCls}>
        <h2 className={`${headingCls} mb-5 border-b border-gray-100 pb-3 dark:border-white/10`}>ข้อมูลเอกสาร</h2>
        <div className="mb-5 grid gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-3 dark:bg-white/5">
          <div><p className="text-gray-500 dark:text-slate-400">ใบซื้ออ้างอิง</p><p className="mt-0.5 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{purchase.purchaseNo}</p></div>
          <div><p className="text-gray-500 dark:text-slate-400">ซัพพลายเออร์</p><p className="mt-0.5 font-medium text-gray-900 dark:text-slate-100">{purchase.supplierName}</p></div>
          <div><p className="text-gray-500 dark:text-slate-400">การลงต้นทุน</p><p className="mt-0.5 font-medium text-gray-900 dark:text-slate-100">{postingNote}</p></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block"><span className={labelCls}>เลข DN ของซัพพลายเออร์ <span className="text-red-500">*</span></span>
            <input className={inputCls} value={header.supplierReferenceNo} maxLength={100} onChange={(e) => setHeaderField("supplierReferenceNo", e.target.value)} /></label>
          <label className="block"><span className={labelCls}>วันที่ออก DN</span>
            <input type="date" className={inputCls} value={header.debitDate} max={today} onChange={(e) => setHeaderField("debitDate", e.target.value)} /></label>
          <label className="block"><span className={labelCls}>วันที่ได้รับ</span>
            <input type="date" className={inputCls} value={header.receivedDate} max={today} onChange={(e) => setHeaderField("receivedDate", e.target.value)} /></label>
          <label className="block"><span className={labelCls}>วันครบกำหนดชำระ</span>
            <input type="date" className={inputCls} value={header.dueDate} onChange={(e) => setHeaderField("dueDate", e.target.value)} /></label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block"><span className={labelCls}>เหตุผลเพิ่มหนี้ <span className="text-red-500">*</span></span>
            <input className={inputCls} value={header.reason} maxLength={1000} placeholder="เช่น ซัพพลายเออร์ปรับราคาย้อนหลัง" onChange={(e) => setHeaderField("reason", e.target.value)} /></label>
          <label className="block"><span className={labelCls}>หมายเหตุ</span>
            <textarea rows={1} className={`${inputCls} resize-y`} value={header.note} maxLength={2000} onChange={(e) => setHeaderField("note", e.target.value)} /></label>
        </div>
      </section>

      <section className={cardCls}>
        <div className="mb-5 flex flex-col gap-2 border-b border-gray-100 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
          <h2 className={headingCls}>รายการปรับราคา</h2>
          <span className="text-sm text-gray-500 dark:text-slate-400">เลือกแล้ว {selectedCount} จาก {purchase.items.length} รายการ</span>
        </div>
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <label className="block"><span className={labelCls}>ราคาส่วนต่าง</span>
            <select className={inputCls} value={vat.vatType} disabled={linesLocked} onChange={(e) => {
              const option = VAT_OPTIONS.find((item) => item.value === e.target.value);
              if (option) changeVat({ vatType: option.value });
            }}>{VAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block"><span className={labelCls}>อัตรา VAT (%)</span>
            <input type="number" className={inputCls} min={0} max={100} step="0.01" value={vat.vatRate} disabled={linesLocked || vat.vatType === "NO_VAT"}
              onChange={(e) => changeVat({ vatRate: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 self-end rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-white/10 dark:text-slate-300">
            <input type="checkbox" className={checkboxCls} checked={vat.vatRecoverable} disabled={linesLocked} onChange={(e) => changeVat({ vatRecoverable: e.target.checked })} />
            VAT ใช้เป็นภาษีซื้อได้
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-white/10">
              <th className={`${thCls} w-10 text-center`}>เลือก</th><th className={`${thCls} text-left`}>สินค้า</th>
              <th className={`${thCls} w-28 text-right`}>ราคาเดิม</th><th className={`${thCls} w-32 text-left`}>จำนวนที่ปรับ</th>
              <th className={`${thCls} w-40 text-left`}>วิธีกรอก</th><th className={`${thCls} w-32 text-left`}>ส่วนต่างเพิ่ม</th>
            </tr></thead>
            <tbody>{purchase.items.map((source, index) => {
              const line = lines[index];
              const rowDisabled = linesLocked || !line.selected;
              return (
                <tr key={source.id} className={`border-b border-gray-100 transition-colors dark:border-white/5 ${line.selected ? "bg-sky-50/60 dark:bg-sky-500/10" : ""}`}>
                  <td className="px-2 py-2 text-center"><input type="checkbox" className={checkboxCls} aria-label={`เลือก ${source.productName}`} checked={line.selected}
                    disabled={linesLocked} onChange={(e) => changeLine(index, { selected: e.target.checked })} /></td>
                  <td className="px-2 py-2">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{source.productName}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400"><span className="font-mono">{source.productCode}</span> · รับ {source.quantity} {source.unitName}</p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-700 dark:text-slate-300">{money(source.price)}</td>
                  <td className="px-2 py-2"><input aria-label={`จำนวน ${source.productCode}`} type="number" className={inputCls} min={0} max={source.quantity} step="0.0001"
                    value={line.affectedQuantity} disabled={rowDisabled} onChange={(e) => changeLine(index, { affectedQuantity: Number(e.target.value) })} /></td>
                  <td className="px-2 py-2"><select aria-label={`วิธีกรอก ${source.productCode}`} className={inputCls} value={line.amountMode} disabled={rowDisabled}
                    onChange={(e) => changeLine(index, { amountMode: e.target.value === "TOTAL" ? "TOTAL" : "PER_UNIT" })}>
                    <option value="PER_UNIT">ต่อ {source.unitName}</option><option value="TOTAL">ยอดรวมของรายการ</option></select></td>
                  <td className="px-2 py-2"><input aria-label={`ส่วนต่าง ${source.productCode}`} type="number" className={inputCls} min={0} step="0.01"
                    value={line.increaseAmount} disabled={rowDisabled} onChange={(e) => changeLine(index, { increaseAmount: Number(e.target.value) })} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">ถ้าซัพพลายเออร์เพิ่มยอดรวมทั้งใบ ให้แบ่งยอดลงรายการสินค้าที่เกี่ยวข้อง เลือก “ยอดรวมของรายการ” และตรวจยอดรวมให้ตรงกับ DN</p>
        <div className="mt-5 flex justify-end border-t border-gray-100 pt-4 dark:border-white/10">
          <DebitSummary preview={preview} needsPreview={needsPreview} />
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-500 dark:text-slate-400">
          {needsPreview ? "ต้องตรวจยอดก่อนบันทึกทุกครั้งที่เปลี่ยนรายการ ยอด หรือ VAT" : "แก้ไขเฉพาะหัวเอกสาร ไม่กระทบสต็อก ต้นทุน และยอดเจ้าหนี้"}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={initial ? `/admin/supplier-debit-notes/${initial.id}` : "/admin/supplier-debit-notes"}
            className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">ยกเลิก</Link>
          {needsPreview ? (
            <button type="button" disabled={pending} onClick={check}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-500 dark:hover:text-sky-300">
              {pending ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />} ตรวจยอด
            </button>
          ) : null}
          <button type="button" disabled={pending || (needsPreview && !preview)} onClick={save}
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-600 dark:hover:bg-orange-500">
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isEdit ? "บันทึกการแก้ไข" : "ยืนยันลง DN"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DebitForm;
