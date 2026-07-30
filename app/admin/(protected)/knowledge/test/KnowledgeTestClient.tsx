"use client";

import { useState, useTransition } from "react";
import { Bot, LoaderCircle, Search } from "lucide-react";
import { testKnowledgeQuestion } from "../actions";

type Result = Awaited<ReturnType<typeof testKnowledgeQuestion>>;

export default function KnowledgeTestClient() {
  const [question, setQuestion] = useState("");
  const [channel, setChannel] = useState<"line" | "messenger">("line");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  const runTest = () => {
    const value = question.trim();
    if (pending || value.length < 2) return;
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await testKnowledgeQuestion(value, channel));
      } catch {
        setResult({ error: "ทดสอบไม่สำเร็จ กรุณาลองใหม่" });
      }
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
