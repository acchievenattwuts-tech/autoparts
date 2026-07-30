"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  Archive,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import {
  approveAndPublishKnowledge,
  archiveKnowledgeSource,
  createKnowledgeRevision,
  rejectKnowledgeRevision,
  retryKnowledgePublish,
  submitKnowledgeForApproval,
} from "./actions";

type Feedback = { text: string; error: boolean } | null;

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
  const [activeAction, setActiveAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  const run = (
    label: string,
    action: () => Promise<{ error?: string }>,
  ) => {
    if (pending) return;
    setActiveAction(label);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback({
          text: result.error ?? "ดำเนินการเรียบร้อย",
          error: Boolean(result.error),
        });
        router.refresh();
      } catch {
        setFeedback({
          text: "ดำเนินการไม่สำเร็จ กรุณาลองใหม่",
          error: true,
        });
      } finally {
        setActiveAction("");
      }
    });
  };

  const icon = (fallback: ReactNode, label: string) =>
    pending && activeAction === label ? (
      <LoaderCircle className="h-4 w-4 animate-spin" />
    ) : (
      fallback
    );

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap gap-2">
        {["DRAFT", "REJECTED", "SYNC_FAILED"].includes(status) && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run("submit", () => submitKnowledgeForApproval(revisionId))
            }
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60"
          >
            {icon(<Send className="h-4 w-4" />, "submit")}
            {pending && activeAction === "submit"
              ? "กำลังส่งอนุมัติ..."
              : "ส่งอนุมัติ"}
          </button>
        )}

        {status === "PENDING_APPROVAL" && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run("approve", () => approveAndPublishKnowledge(revisionId))
              }
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
            >
              {icon(<CheckCircle2 className="h-4 w-4" />, "approve")}
              {pending && activeAction === "approve"
                ? "กำลังสร้าง embedding และเผยแพร่..."
                : "อนุมัติและเผยแพร่"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt("เหตุผลที่ไม่อนุมัติ");
                if (reason)
                  run("reject", () =>
                    rejectKnowledgeRevision(revisionId, reason),
                  );
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              {icon(<XCircle className="h-4 w-4" />, "reject")}
              {pending && activeAction === "reject"
                ? "กำลังบันทึก..."
                : "ไม่อนุมัติ"}
            </button>
          </>
        )}

        {status === "SYNC_FAILED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run("retry", () => retryKnowledgePublish(revisionId))
            }
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60"
          >
            {icon(<RefreshCw className="h-4 w-4" />, "retry")}
            {pending && activeAction === "retry"
              ? "กำลัง Retry Sync..."
              : "Retry Sync"}
          </button>
        )}

        {status === "ACTIVE" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run("revision", () => createKnowledgeRevision(sourceId))
            }
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-wait disabled:opacity-60"
          >
            {icon(<RefreshCw className="h-4 w-4" />, "revision")}
            {pending && activeAction === "revision"
              ? "กำลังสร้าง revision..."
              : "สร้าง revision ใหม่"}
          </button>
        )}

        {hasActive && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  "ยืนยันยกเลิกเผยแพร่? หน้าเว็บและ AI จะหยุดใช้ข้อมูลนี้ทันที",
                )
              )
                run("archive", () => archiveKnowledgeSource(sourceId));
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5"
          >
            {icon(<Archive className="h-4 w-4" />, "archive")}
            {pending && activeAction === "archive"
              ? "กำลังยกเลิกเผยแพร่..."
              : "ยกเลิกเผยแพร่"}
          </button>
        )}
      </div>

      {(pending || feedback) && (
        <p
          className={`text-sm ${feedback?.error ? "text-rose-600 dark:text-rose-300" : "text-slate-600 dark:text-slate-300"}`}
          aria-live="polite"
          role={feedback?.error ? "alert" : "status"}
        >
          {pending ? "ระบบกำลังดำเนินการ กรุณาอย่าปิดหน้านี้..." : feedback?.text}
        </p>
      )}
    </div>
  );
}
