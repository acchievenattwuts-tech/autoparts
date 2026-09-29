"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getThailandDateKey } from "@/lib/th-date";
import { previewDebit, createDebit } from "./actions";

export type DebitPurchase = {
  id: string; purchaseNo: string; supplierName: string; vatType: "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT"; vatRate: number;
  items: Array<{ id: string; productName: string; productCode: string; quantity: number; unitName: string; price: number }>;
};
const inputClass = "w-full rounded border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const money = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DebitForm = ({ purchase }: { purchase: DebitPurchase }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reference, setReference] = useState("");
  const [debitDate, setDebitDate] = useState(getThailandDateKey());
  const [receivedDate, setReceivedDate] = useState(getThailandDateKey());
  const [dueDate, setDueDate] = useState(getThailandDateKey());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [vatType, setVatType] = useState(purchase.vatType);
  const [vatRate, setVatRate] = useState(purchase.vatRate);
  const [vatRecoverable, setVatRecoverable] = useState(true);
  const [items, setItems] = useState(purchase.items.map((item) => ({ purchaseItemId: item.id,
    affectedQuantity: item.quantity, increaseAmount: 0, amountMode: "PER_UNIT" as "PER_UNIT" | "TOTAL", selected: false })));
  const [preview, setPreview] = useState<NonNullable<Awaited<ReturnType<typeof previewDebit>>["preview"]> | null>(null);
  const [error, setError] = useState("");
  const payload = () => ({ purchaseId: purchase.id, supplierReferenceNo: reference, debitDate, receivedDate, dueDate,
    reason, note, vatType, vatRate, vatRecoverable,
    items: items.filter((item) => item.selected).map(({ selected, ...item }) => { void selected; return item; }),
    expectedInventoryAmount: preview?.inventoryAmount, expectedVarianceAmount: preview?.varianceAmount });
  const check = () => startTransition(async () => {
    try { const result = await previewDebit(payload()); setError(result.error ?? ""); setPreview(result.preview ?? null); }
    catch { setError("ตรวจยอดไม่สำเร็จ กรุณาลองใหม่"); }
  });
  const save = () => startTransition(async () => {
    try { const result = await createDebit(payload()); setError(result.error ?? "");
      if (result.id && result.debitNo) { router.push(`/admin/supplier-debit-notes/${result.id}?created=1`); router.refresh(); }
      else setPreview(null);
    } catch { setError("บันทึกไม่สำเร็จ กรุณาลองใหม่"); }
  });
  return <div className="space-y-4 text-slate-800 dark:text-slate-200" onChange={() => setPreview(null)}>
    <p className="rounded bg-sky-50 p-3 dark:bg-sky-950">ใบซื้อ {purchase.purchaseNo} · {purchase.supplierName} — ลงต้นทุนวันนี้ {getThailandDateKey()} โดยไม่รับจำนวนสินค้าเพิ่ม</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label>เลข DN ของ supplier<input className={inputClass} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} /></label>
      <label>วันที่ออก DN<input type="date" className={inputClass} value={debitDate} onChange={(e) => setDebitDate(e.target.value)} /></label>
      <label>วันที่ได้รับ<input type="date" className={inputClass} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></label>
      <label>วันครบกำหนด<input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      <label>ราคาส่วนต่าง<select className={inputClass} value={vatType} onChange={(e) => {
        const value = e.target.value;
        if (value === "NO_VAT" || value === "INCLUDING_VAT" || value === "EXCLUDING_VAT") setVatType(value);
      }}><option value="NO_VAT">ไม่มี VAT</option><option value="EXCLUDING_VAT">ไม่รวม VAT</option><option value="INCLUDING_VAT">รวม VAT</option></select></label>
      <label>VAT (%)<input type="number" className={inputClass} min={0} max={100} step="0.01" value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={vatRecoverable} onChange={(e) => setVatRecoverable(e.target.checked)} /> VAT ใช้เป็นภาษีซื้อได้</label>
    </div>
    <label className="block">เหตุผลเพิ่มหนี้<input className={inputClass} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label>
    <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700"><table className="w-full text-sm"><thead className="bg-slate-100 dark:bg-slate-800"><tr>
      <th className="p-2">เลือก</th><th>สินค้า</th><th>ราคาเดิม</th><th>จำนวนที่ปรับ</th><th>วิธีกรอก</th><th>ส่วนต่างเพิ่ม</th>
    </tr></thead><tbody>{purchase.items.map((source, index) => <tr key={source.id} className="border-t border-slate-200 dark:border-slate-700">
      <td className="p-2"><input type="checkbox" aria-label={`เลือก ${source.productName}`} checked={items[index].selected} onChange={(e) => setItems(items.map((item, i) => i === index ? { ...item, selected: e.target.checked } : item))} /></td>
      <td className="p-2">{source.productCode} · {source.productName}<div className="text-xs text-slate-500 dark:text-slate-400">รับ {source.quantity} {source.unitName}</div></td>
      <td className="p-2 text-right">{money(source.price)}</td>
      <td className="p-2"><input aria-label={`จำนวน ${source.productCode}`} type="number" className={inputClass} min={0} max={source.quantity} step="0.0001" value={items[index].affectedQuantity} onChange={(e) => setItems(items.map((item, i) => i === index ? { ...item, affectedQuantity: Number(e.target.value) } : item))} /></td>
      <td className="p-2"><select aria-label={`วิธีกรอก ${source.productCode}`} className={inputClass} value={items[index].amountMode} onChange={(e) => setItems(items.map((item, i) => i === index ? { ...item, amountMode: e.target.value === "TOTAL" ? "TOTAL" : "PER_UNIT" } : item))}><option value="PER_UNIT">ต่อ {source.unitName}</option><option value="TOTAL">ยอดรวมของรายการ</option></select></td>
      <td className="p-2"><input aria-label={`ส่วนต่าง ${source.productCode}`} type="number" className={inputClass} min={0} step="0.01" value={items[index].increaseAmount} onChange={(e) => setItems(items.map((item, i) => i === index ? { ...item, increaseAmount: Number(e.target.value) } : item))} /></td>
    </tr>)}</tbody></table></div>
    <p className="text-xs text-slate-500 dark:text-slate-400">ถ้า supplier เพิ่มยอดรวมทั้งใบ ให้แบ่งยอดลงรายการสินค้าที่เกี่ยวข้อง เลือก “ยอดรวมของรายการ” และตรวจยอดรวมให้ตรง DN</p>
    <label className="block">หมายเหตุ<textarea className={inputClass} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    {preview && <div className="grid gap-2 rounded bg-emerald-50 p-4 sm:grid-cols-3 dark:bg-emerald-950">
      <p>ก่อน VAT {money(preview.subtotalAmount)}</p><p>VAT {money(preview.vatAmount)}</p><p>เจ้าหนี้เพิ่ม {money(preview.netAmount)}</p>
      <p>เพิ่มมูลค่าสต็อก {money(preview.inventoryAmount)}</p><p>ส่วนต่างต้นทุนงวดนี้ {money(preview.varianceAmount)}</p>
    </div>}
    <div className="flex gap-3"><button type="button" disabled={pending} onClick={check} className="rounded border border-slate-400 px-4 py-2 disabled:opacity-50">{pending ? "กำลังดำเนินการ…" : "ตรวจยอดก่อนบันทึก"}</button>
      <button type="button" disabled={pending || !preview} onClick={save} className="rounded bg-sky-800 px-4 py-2 text-white disabled:opacity-40">ยืนยันลง DN</button></div>
  </div>;
};
export default DebitForm;
