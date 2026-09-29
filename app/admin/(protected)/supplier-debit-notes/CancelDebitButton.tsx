"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { cancelDebit } from "./actions";

const CancelDebitButton = ({ id, docNo }: { id: string; docNo: string }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const close = () => { if (!pending) { setOpen(false); setError(""); } };
  const confirm = () => {
    if (!note.trim()) { setError("กรุณาระบุเหตุผลยกเลิก"); return; }
    setError("");
    startTransition(async () => {
      try {
        const result = await cancelDebit(id, note);
        if (result.error) { setError(result.error); return; }
        setOpen(false); router.refresh();
      } catch { setError("ยกเลิกไม่สำเร็จ กรุณาลองใหม่"); }
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-500/10">
        <Ban size={14} /> ยกเลิก
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="cancel-debit-title">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:border dark:border-white/10 dark:bg-[#101b2e]">
            <h3 id="cancel-debit-title" className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ยืนยันการยกเลิกใบเพิ่มหนี้</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
              เอกสาร <span className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{docNo}</span> จะถูกยกเลิก
              ระบบจะคืนมูลค่าสต็อก คำนวณต้นทุนเฉลี่ยใหม่ และล้างยอดเจ้าหนี้ของ DN นี้
            </p>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">เหตุผลยกเลิก <span className="text-red-500">*</span></span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} autoFocus
                placeholder="ระบุเหตุผลในการยกเลิก"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500" />
            </label>
            {error ? (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={close} disabled={pending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:text-slate-300 dark:hover:bg-white/5">ปิด</button>
              <button type="button" onClick={confirm} disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} ยืนยันยกเลิก
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
export default CancelDebitButton;
