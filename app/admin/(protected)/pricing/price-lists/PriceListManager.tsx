"use client";

import { useRef, useState, useTransition } from "react";
import { applyPriceImport, createPriceList, previewPriceImport, setPriceListActive, updatePriceList } from "./actions";
import { isLegacyFieldPriceListCode } from "@/lib/pricing/price-lists";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";
import {
  ACTION_MESSAGE_BOX_CLASS,
  ACTION_MESSAGE_INLINE_CLASS,
  PRICING_LABEL_CLASS,
  actionMessageRole,
  toActionMessage,
  type ActionMessage,
} from "../action-message";
import { PRICE_LIST_NAME_MAX_LENGTH, PRICE_LIST_SORT_ORDER_MAX, parsePriceListEditInput } from "./price-list-edit";

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
type RowMessage = ActionMessage & { id: string };

const MessageBox = ({ message, className = "" }: { message: ActionMessage | null; className?: string }) =>
  message ? <p role={actionMessageRole(message)} className={`${ACTION_MESSAGE_BOX_CLASS[message.type]} ${className}`}>{message.text}</p> : null;

/** Inline editor that replaces the two chained window.prompt() boxes. */
const PriceListRowEditor = ({
  row,
  pending,
  serverError,
  onSave,
  onCancel,
}: {
  row: Row;
  pending: boolean;
  serverError?: string;
  onSave: (input: { name: string; sortOrder: number }) => void;
  onCancel: () => void;
}) => {
  const [error, setError] = useState("");
  const shownError = error || serverError;
  return (
    <tr className="border-t border-slate-100 bg-sky-50/60 dark:border-white/10 dark:bg-sky-500/10">
      <td colSpan={6} className="p-3">
        <form
          className="grid gap-3 md:grid-cols-[2fr_140px_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const parsed = parsePriceListEditInput(String(form.get("name") ?? ""), String(form.get("sortOrder") ?? ""));
            if ("error" in parsed) {
              setError(parsed.error);
              return;
            }
            setError("");
            onSave(parsed.value);
          }}
        >
          <div>
            <label htmlFor={`price-list-name-${row.id}`} className={PRICING_LABEL_CLASS}>ชื่อระดับราคา ({row.code})</label>
            <input id={`price-list-name-${row.id}`} name="name" required maxLength={PRICE_LIST_NAME_MAX_LENGTH} defaultValue={row.name} className={`${inputClass} w-full`} />
          </div>
          <div>
            <label htmlFor={`price-list-order-${row.id}`} className={PRICING_LABEL_CLASS}>ลำดับ</label>
            <input id={`price-list-order-${row.id}`} name="sortOrder" type="number" required min={0} max={PRICE_LIST_SORT_ORDER_MAX} step={1} defaultValue={row.sortOrder} className={`${inputClass} w-full`} />
          </div>
          <div className="flex gap-2">
            <button disabled={pending} className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-sky-600">{pending ? "กำลังบันทึก..." : "บันทึก"}</button>
            <button type="button" disabled={pending} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-60 dark:border-white/15 dark:text-slate-200">ยกเลิก</button>
          </div>
          {shownError ? <p role="alert" className={`${ACTION_MESSAGE_INLINE_CLASS.error} md:col-span-3`}>{shownError}</p> : null}
        </form>
      </td>
    </tr>
  );
};

export default function PriceListManager({ rows, totalProducts }: { rows: Row[]; totalProducts: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [createMessage, setCreateMessage] = useState<ActionMessage | null>(null);
  const [importMessage, setImportMessage] = useState<ActionMessage | null>(null);
  const [rowMessage, setRowMessage] = useState<RowMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importPriceListId, setImportPriceListId] = useState("");
  const [importCsv, setImportCsv] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-5">
      <form
        ref={formRef}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_2fr_1fr_100px_auto] md:items-end dark:border-white/10 dark:bg-slate-900/60"
        onSubmit={(event) => {
          // onSubmit (not action=) so a rejected create keeps what was typed;
          // React resets an action= form even when the action returns an error.
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          setCreateMessage(null);
          startTransition(async () => {
            const result = await createPriceList(formData);
            setCreateMessage(toActionMessage(result.error, "เพิ่มระดับราคาแล้ว"));
            if (!result.error) formRef.current?.reset();
          });
        }}
      >
        <div>
          <label htmlFor="price-list-create-code" className={PRICING_LABEL_CLASS}>รหัส</label>
          <input id="price-list-create-code" name="code" required placeholder="เช่น TIKTOK" className={`${inputClass} w-full`} />
        </div>
        <div>
          <label htmlFor="price-list-create-name" className={PRICING_LABEL_CLASS}>ชื่อระดับราคา</label>
          <input id="price-list-create-name" name="name" required placeholder="ชื่อระดับราคา" className={`${inputClass} w-full`} />
        </div>
        <div>
          <label htmlFor="price-list-create-channel" className={PRICING_LABEL_CLASS}>ช่องทาง</label>
          <select id="price-list-create-channel" name="channel" defaultValue="" className={`${inputClass} w-full`}>
            <option value="">ไม่ผูกช่องทาง</option>
            <option value="SHOPEE">Shopee</option>
            <option value="LAZADA">Lazada</option>
          </select>
        </div>
        <div>
          <label htmlFor="price-list-create-order" className={PRICING_LABEL_CLASS}>ลำดับ</label>
          <input id="price-list-create-order" name="sortOrder" type="number" min={0} max={PRICE_LIST_SORT_ORDER_MAX} step={1} defaultValue={100} className={`${inputClass} w-full`} />
        </div>
        <button disabled={pending} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">เพิ่ม</button>
        <MessageBox message={createMessage} className="md:col-span-5" />
      </form>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900/60">
        <div>
          <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">นำเข้าราคา CSV</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">หัวตาราง: <code>productCode,price</code> — ตรวจ preview ก่อนเสมอ และไม่ลบราคาที่ไม่ได้อยู่ในไฟล์ · ราคาขายส่ง / สมาชิก / ขายปลีก แก้ได้จากหน้าสินค้าเท่านั้น</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(260px,2fr)_auto]">
          <select
            value={importPriceListId}
            onChange={(event) => { setImportPriceListId(event.target.value); setImportPreview(null); }}
            className={inputClass}
            aria-label="ระดับราคาสำหรับนำเข้า"
          >
            <option value="">เลือกระดับราคา</option>
            {rows.filter((row) => row.isActive && !isLegacyFieldPriceListCode(row.code)).map((row) => <option key={row.id} value={row.id}>{row.name} — {row.code}</option>)}
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
                setImportMessage(null);
                startTransition(async () => {
                  const result = await applyPriceImport(importPriceListId, importCsv);
                  setImportMessage(toActionMessage(result.error, `นำเข้าสำเร็จ ${result.updatedCount?.toLocaleString("th-TH")} รายการ`));
                  if (!result.error) setImportPreview(null);
                });
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-50"
            >ยืนยันนำเข้า</button> : null}
          </div>
        ) : null}
        <MessageBox message={importMessage} />
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <tr><th className="p-3">ระดับราคา</th><th className="p-3">ช่องทาง</th><th className="p-3">ครอบคลุมสินค้า</th><th className="p-3">ประเภทลูกค้า</th><th className="p-3">สถานะ</th><th className="p-3 text-right">จัดการ</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => editingId === row.id ? (
              <PriceListRowEditor
                key={row.id}
                row={row}
                pending={pending}
                serverError={rowMessage?.id === row.id && rowMessage.type === "error" ? rowMessage.text : undefined}
                onCancel={() => {
                  setRowMessage(null);
                  setEditingId(null);
                }}
                onSave={(input) => {
                  setRowMessage(null);
                  startTransition(async () => {
                    const result = await updatePriceList(row.id, input);
                    setRowMessage({ id: row.id, ...toActionMessage(result.error, "แก้ไขแล้ว") });
                    if (!result.error) setEditingId(null);
                  });
                }}
              />
            ) : (
              <tr key={row.id} className={`border-t border-slate-100 dark:border-white/10 ${getAdminMasterRowClass(row.isActive)}`}>
                <td className="p-3"><span className="font-medium text-slate-900 dark:text-slate-100">{row.name}</span><span className="ml-2 text-xs text-slate-400">{row.code}</span></td>
                <td className="p-3 text-slate-600 dark:text-slate-300">{row.channel ?? "—"}</td>
                <td className="p-3 tabular-nums text-slate-600 dark:text-slate-300">{row.productCount}/{totalProducts}</td>
                <td className="p-3 tabular-nums text-slate-600 dark:text-slate-300">{row.customerTypeCount}</td>
                <td className="p-3"><AdminStatusBadge tone={getAdminActiveBadgeTone(row.isActive)}>{row.isActive ? "ใช้งาน" : "ปิดใช้งาน"}</AdminStatusBadge></td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-2"><button
                    disabled={pending}
                    onClick={() => {
                      setRowMessage(null);
                      setEditingId(row.id);
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-40 dark:border-white/15 dark:text-slate-200"
                  >แก้ไข</button><button
                    disabled={pending || (row.isSystem && row.isActive)}
                    onClick={() => {
                      setRowMessage(null);
                      startTransition(async () => {
                        const result = await setPriceListActive(row.id, !row.isActive);
                        setRowMessage({ id: row.id, ...toActionMessage(result.error, row.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว") });
                      });
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-40 dark:border-white/15 dark:text-slate-200"
                  >{row.isActive ? "ปิด" : "เปิด"}</button></div>
                  {rowMessage?.id === row.id ? <p role={actionMessageRole(rowMessage)} className={ACTION_MESSAGE_INLINE_CLASS[rowMessage.type]}>{rowMessage.text}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
