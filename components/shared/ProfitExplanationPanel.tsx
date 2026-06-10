"use client";

import { useEffect, useState, useTransition } from "react";

import type { ProfitRevenueBasis } from "@/lib/profit-dashboard";
import type { ProfitExplanationResult } from "@/lib/profit-explanation/schema";

type HistoryItem = {
  id: string;
  createdAt: string;
  result: ProfitExplanationResult | null;
  status: string;
};

type Props = {
  filters: {
    from: string;
    to: string;
    basis: ProfitRevenueBasis;
  };
};

function confidenceLabel(confidence: ProfitExplanationResult["confidence"]): string {
  if (confidence === "high") return "มั่นใจสูง";
  if (confidence === "medium") return "มั่นใจปานกลาง";
  return "มั่นใจต่ำ";
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ResultView({ result }: { result: ProfitExplanationResult }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-950/70 dark:ring-white/10">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
            {confidenceLabel(result.confidence)}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">AI advisor, read-only</span>
        </div>
        <p className="text-sm leading-6 text-slate-800 dark:text-slate-100">{result.summary}</p>
      </div>

      {result.facts.length ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">ตัวเลขที่ใช้ประกอบ</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.facts.map((fact, index) => (
              <div key={`${fact.label}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-white/5">
                <p className="text-xs text-slate-500 dark:text-slate-400">{fact.label}</p>
                <p className="font-medium text-slate-900 dark:text-slate-100">{fact.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result.drivers.length ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">ที่มาที่ไปของกำไร</h3>
          <div className="mt-2 space-y-2">
            {result.drivers.map((driver, index) => (
              <div key={`${driver.title}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm dark:border-white/10 dark:bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{driver.title}</p>
                  <span
                    className={
                      driver.impact === "positive"
                        ? "text-xs font-semibold text-emerald-600 dark:text-emerald-300"
                        : driver.impact === "negative"
                          ? "text-xs font-semibold text-rose-600 dark:text-rose-300"
                          : "text-xs font-semibold text-slate-500 dark:text-slate-400"
                    }
                  >
                    {driver.impact}
                  </span>
                </div>
                <p className="mt-1 leading-6 text-slate-600 dark:text-slate-300">{driver.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result.anomalies.length ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">จุดผิดปกติ</h3>
          <div className="mt-2 space-y-2">
            {result.anomalies.map((anomaly, index) => (
              <div key={`${anomaly.title}-${index}`} className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-950 ring-1 ring-amber-100 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-300/20">
                <p className="font-medium">{anomaly.title}</p>
                <p className="mt-1 leading-6">{anomaly.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result.recommendedChecks.length ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">ควรตรวจต่อ</h3>
          <div className="mt-2 space-y-2">
            {result.recommendedChecks.map((check, index) => (
              <div key={`${check.label}-${index}`} className="rounded-xl bg-slate-50 px-3 py-3 text-sm dark:bg-white/5">
                <p className="font-medium text-slate-900 dark:text-slate-100">{check.label}</p>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{check.reason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result.limitations.length ? (
        <div className="rounded-2xl bg-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:bg-white/5 dark:text-slate-300">
          ข้อจำกัด: {result.limitations.join(" / ")}
        </div>
      ) : null}
    </div>
  );
}

export default function ProfitExplanationPanel({ filters }: Props) {
  const [result, setResult] = useState<ProfitExplanationResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const params = new URLSearchParams(filters);
    fetch(`/api/admin/profit-explanation?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("โหลดประวัติไม่สำเร็จ"))))
      .then((payload: { items?: HistoryItem[] }) => setHistory(payload.items ?? []))
      .catch(() => setHistory([]));
  }, [filters]);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/admin/profit-explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });

      if (!response.ok) {
        setError("ยังสร้างคำอธิบายไม่ได้ กรุณาลองใหม่หรือเช็ค Gemini key");
        return;
      }

      const payload = (await response.json()) as { explanation?: ProfitExplanationResult };
      if (!payload.explanation) {
        setError("AI ไม่ได้ส่งคำอธิบายกลับมา");
        return;
      }

      setResult(payload.explanation);
      setHistory((items) => [
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          result: payload.explanation ?? null,
          status: "SUCCESS",
        },
        ...items,
      ].slice(0, 5));
    });
  }

  const visibleResult = result ?? history.find((item) => item.result)?.result ?? null;

  return (
    <section className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 shadow-sm dark:border-sky-300/20 dark:from-slate-950 dark:via-slate-950 dark:to-emerald-950/30">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
            Profit Explanation Agent
          </p>
          <h2 className="mt-1 font-kanit text-xl font-semibold text-slate-950 dark:text-slate-100">
            ที่ปรึกษา AI วิเคราะห์กำไรขาดทุน
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            วิเคราะห์จากข้อมูล Profit Dashboard ช่วงที่เลือกเท่านั้น เป็น read-only และเก็บประวัติคำอธิบาย 60 วันล่าสุด
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-200 dark:text-slate-950 dark:hover:bg-sky-100"
        >
          {isPending ? "กำลังวิเคราะห์..." : "อธิบายกำไรช่วงนี้"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-300/20">
          {error}
        </div>
      ) : null}

      {visibleResult ? (
        <ResultView result={visibleResult} />
      ) : (
        <div className="mt-4 rounded-2xl bg-white/70 px-4 py-4 text-sm text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950/60 dark:text-slate-300 dark:ring-white/10">
          กดปุ่มเพื่อให้ AI สรุปเหตุผลกำไร/ขาดทุนจากตัวเลขบน dashboard นี้ โดยไม่มีการแก้ไขข้อมูลใด ๆ
        </div>
      )}

      {history.length ? (
        <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
          ประวัติล่าสุด: {history.slice(0, 3).map((item) => formatCreatedAt(item.createdAt)).join(" / ")}
        </div>
      ) : null}
    </section>
  );
}
