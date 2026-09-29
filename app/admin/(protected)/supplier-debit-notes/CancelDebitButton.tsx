"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelDebit } from "./actions";
const CancelDebitButton = ({ id }: { id: string }) => {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <div className="flex flex-wrap gap-2"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
    aria-label="เหตุผลยกเลิก DN" placeholder="เหตุผลยกเลิก DN" className="rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" />
    <button disabled={pending || !note.trim()} type="button" className="rounded bg-red-700 px-4 py-2 text-white disabled:opacity-40" onClick={() => startTransition(async () => {
      try { const result = await cancelDebit(id, note); setError(result.error ?? ""); if (result.success) router.refresh(); }
      catch { setError("ยกเลิกไม่สำเร็จ กรุณาลองใหม่"); }
    })}>{pending ? "กำลังยกเลิก…" : "ยืนยันยกเลิก DN"}</button>
    {error && <p role="alert" className="w-full text-red-700 dark:text-red-300">{error}</p>}
  </div>;
};
export default CancelDebitButton;
