"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { formatDateThai } from "@/lib/th-date";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import { approveAiCategoryAlias, rejectAiCategoryAlias } from "./actions";

export type PendingSuggestion = {
  id: string;
  alias: string;
  correctedTerm: string | null;
  categoryName: string | null;
  notes: string | null;
  createdAt: Date;
};

interface AiSuggestionsPanelProps {
  suggestions: PendingSuggestion[];
  canReview: boolean;
}

const AiSuggestionsPanel = ({ suggestions, canReview }: AiSuggestionsPanelProps) => {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (id: string, action: (id: string) => Promise<{ error?: string }>) => {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await action(id);
      if (result?.error) setError(result.error);
      setBusyId(null);
    });
  };

  return (
    <AdminSectionCard
      title="คำที่ AI เสนอ (รออนุมัติ)"
      description="เมื่อลูกค้าพิมพ์คำผิดแล้ว AI แก้ไขและจับหมวดได้ ระบบจะเสนอคำนั้นไว้ที่นี่ อนุมัติเพื่อเปิดใช้ (สร้าง alias + คำพ้องค้นหา) หรือปฏิเสธเพื่อไม่ให้เสนอซ้ำ"
    >
      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {suggestions.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          ยังไม่มีรายการที่ AI เสนอรออนุมัติ
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="px-3 py-2 font-medium">คำที่ลูกค้าพิมพ์</th>
                <th className="px-3 py-2 font-medium">แก้เป็น</th>
                <th className="px-3 py-2 font-medium">หมวดที่จับได้</th>
                <th className="px-3 py-2 font-medium">วันที่</th>
                <th className="px-3 py-2 text-right font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{s.alias}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{s.correctedTerm ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{s.categoryName ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDateThai(s.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={!canReview || pending}
                        onClick={() => run(s.id, approveAiCategoryAlias)}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {busyId === s.id && pending ? "กำลังทำ..." : "อนุมัติ"}
                      </button>
                      <button
                        type="button"
                        disabled={!canReview || pending}
                        onClick={() => run(s.id, rejectAiCategoryAlias)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <X className="h-3.5 w-3.5" />
                        ปฏิเสธ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSectionCard>
  );
};

export default AiSuggestionsPanel;
