"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { updateWhtReceivedCertificate } from "./actions";

interface Props {
  id: string;
  certNo: string;
  certDate: string;
  received: boolean;
  canEdit: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20";

/** ช่องจัดการหนังสือรับรอง 50 ทวิ ของแต่ละรายการในทะเบียนภาษีถูกหัก */
const WhtCertificateCell = ({ id, certNo, certDate, received, canEdit }: Props) => {
  const [editing, setEditing] = useState(false);
  const [formCertNo, setFormCertNo] = useState(certNo);
  const [formCertDate, setFormCertDate] = useState(certDate);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (markReceived: boolean) => {
    setError("");
    const formData = new FormData();
    formData.set("id", id);
    formData.set("certNo", formCertNo);
    formData.set("certDate", formCertDate);
    formData.set("received", markReceived ? "true" : "false");

    startTransition(async () => {
      const result = await updateWhtReceivedCertificate(formData);
      if (result.success) {
        setEditing(false);
        return;
      }
      setError(result.error ?? "บันทึกไม่สำเร็จ");
    });
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {received ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                <Check size={12} /> ได้รับแล้ว
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                {certNo || "-"}
                {certDate ? ` · ${certDate}` : ""}
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              ยังไม่ได้รับใบ
            </span>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#1e3a5f] dark:hover:bg-white/10 dark:hover:text-sky-300"
            title="แก้ไขข้อมูลหนังสือรับรอง"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={formCertNo}
        maxLength={50}
        disabled={isPending}
        onChange={(event) => setFormCertNo(event.target.value)}
        placeholder="เลขที่ 50 ทวิ"
        className={inputClass}
      />
      <input
        type="date"
        value={formCertDate}
        disabled={isPending}
        onChange={(event) => setFormCertDate(event.target.value)}
        className={inputClass}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit(true)}
          className="rounded-lg bg-[#1e3a5f] px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก..." : "ได้รับแล้ว"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit(false)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
        >
          ยังไม่ได้รับ
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setEditing(false);
            setError("");
            setFormCertNo(certNo);
            setFormCertDate(certDate);
          }}
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60 dark:hover:bg-white/10"
          title="ยกเลิก"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default WhtCertificateCell;
