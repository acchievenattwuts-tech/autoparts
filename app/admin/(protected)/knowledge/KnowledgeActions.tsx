"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, CheckCircle2, RefreshCw, Send, XCircle } from "lucide-react";
import {
  approveAndPublishKnowledge,
  archiveKnowledgeSource,
  createKnowledgeRevision,
  rejectKnowledgeRevision,
  retryKnowledgePublish,
  submitKnowledgeForApproval,
} from "./actions";

export default function KnowledgeActions({
  sourceId,
  revisionId,
  status,
  hasActive,
}: {
  sourceId: string;
  revisionId: string;
  status: string;
  hasActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const run = (action: () => Promise<{ error?: string }>) => startTransition(async () => {
    setMessage("");
    const result = await action();
    setMessage(result.error ?? "ดำเนินการเรียบร้อย");
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {["DRAFT", "REJECTED", "SYNC_FAILED"].includes(status) && (
          <button disabled={pending} onClick={() => run(() => submitKnowledgeForApproval(revisionId))} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"><Send className="h-4 w-4" />ส่งอนุมัติ</button>
        )}
        {status === "PENDING_APPROVAL" && (
          <>
            <button disabled={pending} onClick={() => run(() => approveAndPublishKnowledge(revisionId))} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />อนุมัติและเผยแพร่</button>
            <button disabled={pending} onClick={() => { const reason = window.prompt("เหตุผลที่ไม่อนุมัติ"); if (reason) run(() => rejectKnowledgeRevision(revisionId, reason)); }} className="inline-flex items-center gap-2 rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"><XCircle className="h-4 w-4" />ไม่อนุมัติ</button>
          </>
        )}
        {status === "SYNC_FAILED" && <button disabled={pending} onClick={() => run(() => retryKnowledgePublish(revisionId))} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />Retry Sync</button>}
        {status === "ACTIVE" && <button disabled={pending} onClick={() => run(() => createKnowledgeRevision(sourceId))} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />สร้าง revision ใหม่</button>}
        {hasActive && <button disabled={pending} onClick={() => { if (window.confirm("ยืนยันยกเลิกเผยแพร่? หน้าเว็บและ AI จะหยุดใช้ข้อมูลนี้ทันที")) run(() => archiveKnowledgeSource(sourceId)); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5"><Archive className="h-4 w-4" />ยกเลิกเผยแพร่</button>}
      </div>
      {message && <p className="text-sm text-slate-600 dark:text-slate-300" aria-live="polite">{pending ? "กำลังดำเนินการ..." : message}</p>}
    </div>
  );
}
