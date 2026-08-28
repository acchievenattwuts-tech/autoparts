"use client";

import { useRef, useState, useTransition } from "react";
import { applyPriceImport, createPriceList, previewPriceImport, setPriceListActive, updatePriceList } from "./actions";

type Row = {
  id: string;
  code: string;
  name: string;
  channel: string | null;
  isActive: boolean;
  isSystem: boolean;
  productCount: number;
  customerTypeCount: number;
  sortOrder: number;
};

const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-slate-100";

type ImportPreview = Awaited<ReturnType<typeof previewPriceImport>>;

export default function PriceListManager({ rows, totalProducts }: { rows: Row[]; totalProducts: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState("");
  const [importPriceListId, setImportPriceListId] = useState("");
  const [importCsv, setImportCsv] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-5">
      <form
        ref={formRef}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_2fr_1fr_100px_auto] dark:border-white/10 dark:bg-slate-900/60"
        action={(formData) => startTransition(async () => {
          const result = await createPriceList(formData);
          setMessage(result.error ?? "เพิ่ม Price List แล้ว");
          if (!result.error) formRef.current?.reset();
        })}
      >
        <input name="code" required placeholder="รหัส เช่น TIKTOK" className={inputClass} />
        <input name="name" required placeholder="ชื่อ Price List" className={inputClass} />
        <select name="channel" defaultValue="" className={inputClass}>
          <option value="">ไม่ผูกช่องทาง</option>
          <option value="SHOPEE">Shopee</option>
          <option value="LAZADA">Lazada</option>
        </select>
        <input name="sortOrder" type="number" min={0} defaultValue={100} className={inputClass} />
        <button disabled={pending} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">เพิ่ม</button>
        {message ? <p className="text-sm text-slate-600 md:col-span-5 dark:text-slate-300">{message}</p> : null}
      </form>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900/60">
        <div>
          <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">นำเข้าราคา CSV</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">หัวตาราง: <code>productCode,price</code> — ตรวจ preview ก่อนเสมอ และไม่ลบราคาที่ไม่ได้อยู่ในไฟล์</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(260px,2fr)_auto]">
          <select
            value={importPriceListId}
            onChange={(event) => { setImportPriceListId(event.target.value); setImportPreview(null); }}
            className={inputClass}
            aria-label="Price List สำหรับนำเข้า"
          >
            <option value="">เลือก Price List</option>
            {rows.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name} — {row.code}</option>)}
          </select>
          <input
            type="file"
            accept=".csv,text/csv"
            className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 dark:file:bg-white/10 dark:file:text-slate-200`}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              setImportPreview(null);
              setImportFileName(file?.name ?? "");
              setImportCsv(file ? await file.text() : "");
            }}
          />
          <button
            type="button"
            disabled={pending || !importPriceListId || !importCsv}
            onClick={() => startTransition(async () => setImportPreview(await previewPriceImport(importPriceListId, importCsv)))}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
          >ตรวจ Preview</button>
        </div>
        {importPreview ? (
          <div className={`space-y-2 rounded-lg border p-3 text-sm ${importPreview.errors.length > 0 ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/40 dark:bg-rose-950/30 dark:text-rose-200" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-950/30 dark:text-emerald-200"}`}>
            <p className="font-medium">{importFileName || "CSV"}: {importPreview.rowCount.toLocaleString("th-TH")} รายการ</p>
            <p>เพิ่ม {importPreview.createCount.toLocaleString("th-TH")} · แก้ไข {importPreview.updateCount.toLocaleString("th-TH")} · ค่าเดิม {importPreview.unchangedCount.toLocaleString("th-TH")}</p>
            <p>ความครอบคลุมหลังนำเข้า {importPreview.coveredAfterImport.toLocaleString("th-TH")}/{importPreview.totalActiveProducts.toLocaleString("th-TH")} สินค้าที่เปิดใช้งาน</p>
            {importPreview.errors.map((error) => <p key={error}>• {error}</p>)}
            {importPreview.missingProductCodes.length > 0 ? <p>รหัสที่ไม่พบ: {importPreview.missingProductCodes.slice(0, 20).join(", ")}{importPreview.missingProductCodes.length > 20 ? " …" : ""}</p> : null}
            {importPreview.errors.length === 0 ? <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`ยืนยันนำเข้า ${importPreview.rowCount.toLocaleString("th-TH")} รายการหรือไม่?`)) return;
                startTransition(async () => {
                  const result = await applyPriceImport(importPriceListId, importCsv);
                  setMessage(result.error ?? `นำเข้าสำเร็จ ${result.updatedCount?.toLocaleString("th-TH")} รายการ`);
                  if (!result.error) setImportPreview(null);
                });
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-50"
            >ยืนยันนำเข้า</button> : null}
          </div>
        ) : null}
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <tr><th className="p-3">Price List</th><th className="p-3">ช่องทาง</th><th className="p-3">ครอบคลุมสินค้า</th><th className="p-3">ประเภทลูกค้า</th><th className="p-3">สถานะ</th><th className="p-3 text-right">จัดการ</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 dark:border-white/10">
                <td className="p-3"><span className="font-medium text-slate-900 dark:text-slate-100">{row.name}</span><span className="ml-2 text-xs text-slate-400">{row.code}</span></td>
                <td className="p-3 text-slate-600 dark:text-slate-300">{row.channel ?? "—"}</td>
                <td className="p-3 tabular-nums text-slate-600 dark:text-slate-300">{row.productCount}/{totalProducts}</td>
                <td className="p-3 tabular-nums text-slate-600 dark:text-slate-300">{row.customerTypeCount}</td>
                <td className="p-3">{row.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-2"><button
                    disabled={pending}
                    onClick={() => {
                      const name = window.prompt("ชื่อ Price List", row.name)?.trim();
                      if (!name) return;
                      const orderText = window.prompt("ลำดับ", String(row.sortOrder));
                      if (orderText === null) return;
                      const sortOrder = Number(orderText);
                      startTransition(async () => setMessage((await updatePriceList(row.id, { name, sortOrder })).error ?? "แก้ไขแล้ว"));
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-40 dark:border-white/15 dark:text-slate-200"
                  >แก้ไข</button><button
                    disabled={pending || (row.isSystem && row.isActive)}
                    onClick={() => startTransition(async () => {
                      const result = await setPriceListActive(row.id, !row.isActive);
                      setMessage(result.error ?? (row.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว"));
                    })}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-40 dark:border-white/15 dark:text-slate-200"
                  >{row.isActive ? "ปิด" : "เปิด"}</button></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
