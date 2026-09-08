"use client";
import { formatQuotationReference } from "@/lib/sales-quotation-form";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FileText } from "lucide-react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { formatDateThai } from "@/lib/th-date";
import { loadQuotationForSale, searchAvailableQuotations } from "../../sales-quotations/actions";
export type LoadedQuotation = Extract<Awaited<ReturnType<typeof loadQuotationForSale>>, { data: object }>;

export default function SaleQuotationPicker({ value, label, saleId, initialLoadId, onLoad, onDetach }: {
  value: string; label: string; saleId?: string; initialLoadId?: string; onLoad: (id: string, quote: LoadedQuotation) => void; onDetach: () => void;
}) {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [listLoading, setListLoading] = useState(true);
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
  /** โหลด SQ ที่ยังใช้งานอยู่และยังไม่ถูกใบขายอื่นอ้างอิง — ค้นหาต่อได้ในช่องค้นหาของ dropdown */
  const loadOptions = useCallback(async () => {
    setListLoading(true);
    try {
      const rows = await searchAvailableQuotations("", saleId);
      setOptions(rows.map((row) => ({
        id: row.id,
        label: `${formatQuotationReference(row.quotationNo, row.revision)} — ${row.customerName}`,
        sublabel: `${formatDateThai(row.quotationDate)} · ${row.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
      })));
      setError("");
    } catch {
      setError("โหลดรายการใบเสนอราคาไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setListLoading(false);
    }
  }, [saleId]);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadOptions();
    if (initialLoadId) load(initialLoadId, false);
    // Initial navigation imports exactly once; subsequent imports are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selectOptions = value && !options.some((row) => row.id === value)
    ? [{ id: value, label: label || value }, ...options]
    : options;
  return <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
        <FileText size={15} className="shrink-0" />
        <span>อ้างอิงใบเสนอราคา (SQ)</span>
        <span className="text-xs text-gray-400 dark:text-slate-500">ไม่บังคับ</span>
      </div>
      <div className="w-full sm:ml-auto sm:w-80">
        <SearchableSelect
          options={selectOptions}
          value={value}
          onChange={(id) => { if (id) load(id, true); }}
          disabled={pending || listLoading}
          emptyTone="neutral"
          placeholder={listLoading ? "กำลังโหลด..." : options.length ? "เลือกใบเสนอราคา" : "ไม่มีใบเสนอราคาที่พร้อมอ้างอิง"}
        />
      </div>
      {value && <button type="button" disabled={pending} className="self-start text-sm text-gray-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-60 dark:text-slate-400 dark:hover:text-red-300 sm:self-auto" onClick={onDetach}>ถอด SQ</button>}
    </div>
    {value && <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">{label} — การผูกหรือถอดอ้างอิงมีผลเมื่อบันทึกใบขาย</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
  </div>;
}
