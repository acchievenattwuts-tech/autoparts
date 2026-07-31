"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FilePlus2, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import {
  createDraftFromKnowledgeGap,
  dismissKnowledgeGap,
  reviewKnowledgeGap,
} from "./actions";

type Gap = {
  id: string;
  status: string;
  internalTitle: string | null;
  sourceId: string | null;
};

export default function QualityGapActions({ gap }: { gap: Gap }) {
  const [title, setTitle] = useState(gap.internalTitle ?? "");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const run = (action: () => Promise<{ success?: boolean; error?: string }>) => {
    if (pending) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback({
        ok: Boolean(result.success),
        text: result.success ? "บันทึกแล้ว" : result.error ?? "ดำเนินการไม่สำเร็จ",
      });
    });
  };

  if (gap.status === "DRAFT_CREATED" && gap.sourceId) {
    return (
      <Link
        href={`/admin/knowledge/${gap.sourceId}`}
        className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700"
      >
        <FilePlus2 className="h-3.5 w-3.5" />
        เปิดร่าง
      </Link>
    );
  }

  if (gap.status === "REVIEWED") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">{gap.internalTitle}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => createDraftFromKnowledgeGap(gap.id))}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FilePlus2 className="h-3.5 w-3.5" />
            )}
            สร้างร่างที่ปิด RAG
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => dismissKnowledgeGap(gap.id))}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            <XCircle className="h-3.5 w-3.5" />
            ข้าม
          </button>
        </div>
        {feedback && (
          <p
            role={feedback.ok ? "status" : "alert"}
            className={`text-xs ${feedback.ok ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="min-w-64 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData();
        formData.set("gapId", gap.id);
        formData.set("internalTitle", title);
        run(() => reviewKnowledgeGap(formData));
      }}
    >
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        disabled={pending}
        required
        minLength={5}
        maxLength={180}
        placeholder="ตั้งชื่อหัวข้อความรู้ภายใน"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:opacity-50 dark:border-white/10 dark:bg-slate-900"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || title.trim().length < 5}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          ตรวจแล้ว
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => dismissKnowledgeGap(gap.id))}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
        >
          <XCircle className="h-3.5 w-3.5" />
          ข้าม
        </button>
      </div>
      {feedback && (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={`text-xs ${feedback.ok ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}
