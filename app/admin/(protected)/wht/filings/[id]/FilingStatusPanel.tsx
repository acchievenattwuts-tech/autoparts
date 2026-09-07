"use client";

import { useState, useTransition } from "react";
import { CheckCircle } from "lucide-react";
import { getThailandDateKey } from "@/lib/th-date";
import { cancelFiling, markFilingFiled } from "../actions";

interface Props {
  filingId: string;
  status: "DRAFT" | "FILED" | "CANCELLED";
  canManage: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20";
const labelClass = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300";

/** บันทึกผลการยื่นแบบ และยกเลิกรอบยื่น (ยกเลิกแล้วใบรับรองกลับไปเป็น "ยังไม่ยื่น") */
const FilingStatusPanel = ({ filingId, status, canManage }: Props) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [filedAt, setFiledAt] = useState(getThailandDateKey());
  const [filedChannel, setFiledChannel] = useState("SWC");
  const [rdRefNo, setRdRefNo] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (!canManage || status === "CANCELLED") return null;

  const submitFiled = () => {
    setError("");
    const formData = new FormData();
    formData.set("filingId", filingId);
    formData.set("filedAt", filedAt);
    formData.set("filedChannel", filedChannel);
    formData.set("rdRefNo", rdRefNo);

    startTransition(async () => {
      const result = await markFilingFiled(formData);
      if (!result.success) setError(result.error ?? "บันทึกไม่สำเร็จ");
    });
  };

  const submitCancel = () => {
    setError("");
    const formData = new FormData();
    formData.set("filingId", filingId);
    formData.set("cancelNote", cancelNote);

    startTransition(async () => {
      const result = await cancelFiling(formData);
      if (!result.success) setError(result.error ?? "ยกเลิกไม่สำเร็จ");
      else setConfirmingCancel(false);
    });
  };

  return (
    <div className="no-print rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/40">
      {status === "FILED" ? (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle size={16} /> บันทึกว่ายื่นแบบแล้ว
        </p>
      ) : (
        <>
          <p className="mb-3 font-kanit text-sm font-semibold text-slate-800 dark:text-slate-100">
            บันทึกผลการยื่นแบบ
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>วันที่ยื่น</label>
              <input
                type="date"
                value={filedAt}
                disabled={isPending}
                onChange={(event) => setFiledAt(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>ช่องทางยื่น</label>
              <select
                value={filedChannel}
                disabled={isPending}
                onChange={(event) => setFiledChannel(event.target.value)}
                className={inputClass}
              >
                <option value="SWC">ฝากไฟล์ผ่าน SWC</option>
                <option value="RD_PREP">RD Prep</option>
                <option value="EFILING">e-Filing</option>
                <option value="PAPER">ยื่นกระดาษที่สรรพากรพื้นที่</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>เลขอ้างอิงจากกรมสรรพากร</label>
              <input
                type="text"
                maxLength={50}
                value={rdRefNo}
                disabled={isPending}
                onChange={(event) => setRdRefNo(event.target.value)}
                className={inputClass}
                placeholder="ไม่บังคับ"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={submitFiled}
            className="mt-3 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
          >
            {isPending ? "กำลังบันทึก..." : "ยืนยันว่ายื่นแบบแล้ว"}
          </button>
        </>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/5">
        {confirmingCancel ? (
          <div className="space-y-2">
            <input
              type="text"
              maxLength={200}
              value={cancelNote}
              disabled={isPending}
              onChange={(event) => setCancelNote(event.target.value)}
              className={inputClass}
              placeholder="เหตุผลที่ยกเลิกรอบยื่น"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ยกเลิกแล้วหนังสือรับรองทุกใบในรอบจะกลับไปเป็น &ldquo;ยังไม่ยื่น&rdquo; และนำไปจัดรอบใหม่ได้
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={submitCancel}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {isPending ? "กำลังยกเลิก..." : "ยืนยันยกเลิกรอบยื่น"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirmingCancel(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
              >
                ไม่ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingCancel(true)}
            className="text-xs font-medium text-red-600 transition-colors hover:text-red-700 dark:text-red-400"
          >
            ยกเลิกรอบยื่นนี้
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
};

export default FilingStatusPanel;
