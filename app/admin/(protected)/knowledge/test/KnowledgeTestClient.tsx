"use client";

import { useState, useTransition } from "react";
import { Bot, LoaderCircle, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { testKnowledgeQuestion } from "../actions";
import { submitKnowledgeRagFeedback } from "../quality/actions";
import {
  KNOWLEDGE_FEEDBACK_REASONS,
  type KnowledgeFeedbackReason,
} from "@/lib/knowledge-rag-feedback";

type Result = Awaited<ReturnType<typeof testKnowledgeQuestion>>;

export default function KnowledgeTestClient() {
  const [question, setQuestion] = useState("");
  const [channel, setChannel] = useState<"line" | "messenger">("line");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const [feedbackPending, startFeedbackTransition] = useTransition();
  const [badReason, setBadReason] =
    useState<Exclude<KnowledgeFeedbackReason, "HELPFUL">>("INCOMPLETE");
  const [feedbackState, setFeedbackState] = useState<{
    saved: boolean;
    error?: string;
  } | null>(null);

  const runTest = () => {
    const value = question.trim();
    if (pending || value.length < 2) return;
    setResult(null);
    setFeedbackState(null);
    startTransition(async () => {
      try {
        setResult(await testKnowledgeQuestion(value, channel));
      } catch {
        setResult({ error: "ทดสอบไม่สำเร็จ กรุณาลองใหม่" });
      }
    });
  };

  const saveFeedback = (rating: "GOOD" | "BAD") => {
    if (
      feedbackPending ||
      !result ||
      !("success" in result) ||
      !result.success ||
      !result.feedbackContext
    ) {
      return;
    }
    startFeedbackTransition(async () => {
      const response = await submitKnowledgeRagFeedback({
        ...result.feedbackContext,
        rating,
        reasonCode: rating === "GOOD" ? "HELPFUL" : badReason,
      });
      setFeedbackState(
        response.success
          ? { saved: true }
          : { saved: false, error: response.error ?? "บันทึกไม่สำเร็จ" },
      );
    });
  };

  return (
    <div className="space-y-5" aria-busy={pending}>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
        <div className="grid gap-3 md:grid-cols-[160px_1fr_auto]">
          <select
            value={channel}
            disabled={pending}
            aria-label="ช่องทางที่ต้องการทดสอบ"
            onChange={(event) =>
              setChannel(event.target.value as "line" | "messenger")
            }
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-slate-900"
          >
            <option value="line">LINE</option>
            <option value="messenger">Messenger</option>
          </select>
          <input
            value={question}
            disabled={pending}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runTest();
              }
            }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-slate-900"
            placeholder="พิมพ์คำถามเหมือนลูกค้าจริง"
          />
          <button
            type="button"
            disabled={pending || question.trim().length < 2}
            onClick={runTest}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-50"
          >
            {pending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {pending ? "กำลังค้นและสร้างคำตอบ..." : "ทดลอง"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Dry-run เท่านั้น ระบบจะไม่ส่งข้อความให้ลูกค้าจริง
        </p>
        {pending && (
          <p className="mt-3 text-sm text-sky-700 dark:text-sky-300" role="status" aria-live="polite">
            กำลังค้นเอกสารและตรวจคำตอบกับ RAG กรุณารอสักครู่...
          </p>
        )}
      </div>

      {result && "error" in result && result.error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
          {result.error}
        </div>
      )}

      {result && "success" in result && result.success && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-sky-600" />
              <h2 className="font-kanit font-semibold text-slate-900 dark:text-white">
                ผลการตัดสินใจของ AI
              </h2>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-700 dark:text-slate-300">
              {result.answer.answered
                ? result.answer.reply
                : "RAG ไม่ตอบคำถามนี้ ระบบจริงจะใช้ fallback/ส่งต่อเส้นทางเดิม"}
            </p>
            <p className="mt-3 text-xs font-medium text-slate-500">
              สถานะ: {result.answer.answered ? "RAG ตอบได้" : "RAG ไม่ตอบ"}
            </p>
            {result.answer.citations.length > 0 && (
              <ul className="mt-3 text-xs text-sky-700 dark:text-sky-300">
                {result.answer.citations.map((item) => (
                  <li key={item.id}>
                    {item.title} ({item.id})
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-white/10">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                คำตอบนี้มีคุณภาพหรือไม่
              </p>
              <p className="mt-1 text-xs text-slate-500">
                ระบบเก็บเฉพาะคะแนน เหตุผล และ query hash ไม่เก็บข้อความที่พิมพ์
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={feedbackPending || feedbackState?.saved}
                  onClick={() => saveFeedback("GOOD")}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                >
                  {feedbackPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ThumbsUp className="h-4 w-4" />
                  )}
                  ดี
                </button>
                <select
                  value={badReason}
                  disabled={feedbackPending || feedbackState?.saved}
                  onChange={(event) =>
                    setBadReason(
                      event.target.value as Exclude<
                        KnowledgeFeedbackReason,
                        "HELPFUL"
                      >,
                    )
                  }
                  aria-label="เหตุผลที่คำตอบต้องปรับปรุง"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-white/10 dark:bg-slate-900"
                >
                  {Object.entries(KNOWLEDGE_FEEDBACK_REASONS)
                    .filter(([code]) => code !== "HELPFUL")
                    .map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={feedbackPending || feedbackState?.saved}
                  onClick={() => saveFeedback("BAD")}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                >
                  <ThumbsDown className="h-4 w-4" />
                  ต้องปรับ
                </button>
              </div>
              {feedbackState && (
                <p
                  className={`mt-3 text-xs ${feedbackState.saved ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}
                  role={feedbackState.saved ? "status" : "alert"}
                >
                  {feedbackState.saved
                    ? "บันทึก feedback แล้ว"
                    : feedbackState.error}
                </p>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
            <h2 className="font-kanit font-semibold text-slate-900 dark:text-white">
              เอกสารที่ค้นคืนได้
            </h2>
            <div className="mt-3 space-y-3">
              {result.rows.map((row) => (
                <div key={row.id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {row.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.heading} · semantic {row.semantic.toFixed(3)} · hybrid {row.hybrid.toFixed(3)}
                  </p>
                </div>
              ))}
              {result.rows.length === 0 && (
                <p className="text-sm text-slate-500">
                  ไม่พบเอกสารผ่าน threshold
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
