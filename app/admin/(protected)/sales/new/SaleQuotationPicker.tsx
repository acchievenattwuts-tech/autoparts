"use client";
import { formatQuotationReference } from "@/lib/sales-quotation-form";
import { useEffect, useRef, useState, useTransition } from "react";
import SearchableSelect from "@/components/shared/SearchableSelect";
import { loadQuotationForSale, searchAvailableQuotations } from "../../sales-quotations/actions";
export type LoadedQuotation = Extract<Awaited<ReturnType<typeof loadQuotationForSale>>, { data: object }>;

export default function SaleQuotationPicker({ value, label, saleId, initialLoadId, onLoad, onDetach }: {
  value: string; label: string; saleId?: string; initialLoadId?: string; onLoad: (id: string, quote: LoadedQuotation) => void; onDetach: () => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const initialized = useRef(false);
  const load = (id: string, confirm: boolean) => {
    if (confirm && !window.confirm("ดึงข้อมูลใบเสนอราคามาแทนข้อมูลลูกค้าและรายการสินค้าในฟอร์มนี้หรือไม่?")) return;
    startTransition(async () => {
      try {
        const result = await loadQuotationForSale(id, saleId);
        if ("error" in result) setError(result.error ?? "โหลดใบเสนอราคาไม่สำเร็จ");
        else { onLoad(id, result); setError(""); }
      } catch { setError("โหลดใบเสนอราคาไม่สำเร็จ กรุณาตรวจสอบสิทธิ์และลองอีกครั้ง"); }
    });
  };
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (initialLoadId) load(initialLoadId, false);
    // Initial navigation imports exactly once; subsequent imports are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/40">
    <p className="mb-2 font-semibold text-sky-900 dark:text-sky-100">อ้างอิงใบเสนอราคา (SQ)</p>
    <div className="flex flex-wrap items-center gap-3">
      <input aria-label="ค้นหาใบเสนอราคา" className="rounded border bg-white px-3 py-2 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="เลข SQ / ชื่อลูกค้า" />
      <button type="button" disabled={pending} onClick={() => startTransition(async () => {
        try { const rows = await searchAvailableQuotations(query, saleId); setOptions(rows.map((row) => ({ id: row.id, label: `${formatQuotationReference(row.quotationNo, row.revision)} — ${row.customerName}` }))); setError(rows.length ? "" : "ไม่พบใบเสนอราคาที่พร้อมให้อ้างอิง"); }
        catch { setError("ค้นหาไม่สำเร็จ กรุณาลองอีกครั้ง"); }
      })}>{pending ? "กำลังโหลด..." : "ค้นหา SQ"}</button>
      <div className="min-w-64"><SearchableSelect options={value && !options.some((row) => row.id === value) ? [{ id: value, label: label || value }, ...options] : options} value={value} onChange={(id) => { if (id) load(id, true); }} disabled={pending} placeholder="เลือกใบเสนอราคา" /></div>
      {value && <button type="button" disabled={pending} className="text-red-600 dark:text-red-300" onClick={onDetach}>ถอด SQ ที่อ้างอิง</button>}
    </div>
    {value && <p className="mt-2 text-sm text-sky-800 dark:text-sky-200">{label} — การผูกหรือถอดอ้างอิงมีผลเมื่อบันทึกใบขาย</p>}
    {error && <p role="alert" className="mt-2 text-red-600 dark:text-red-300">{error}</p>}
  </div>;
}
