"use client";

import { useState } from "react";
import { BadgeCheck, FileText, ShieldCheck } from "lucide-react";

const STORAGE_KEY = "liff_onboarded";

export default function WelcomeScreen() {
  const [shouldShow, setShouldShow] = useState(
    () =>
      typeof window !== "undefined" &&
      !new URLSearchParams(window.location.search).has("printToken") &&
      window.localStorage.getItem(STORAGE_KEY) !== "1",
  );

  if (!shouldShow) return null;

  return (
    <div className="fixed inset-0 z-50 bg-blue-950/35 px-5 py-8 backdrop-blur-sm dark:bg-slate-950/70">
      <div className="mx-auto flex min-h-full max-w-sm items-center">
        <div className="w-full rounded-[28px] border border-blue-100 bg-white p-5 shadow-2xl shadow-blue-950/20 dark:border-slate-700 dark:bg-slate-900 dark:shadow-slate-950/50">
          <div className="mb-5 rounded-[24px] border border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 p-4 dark:border-slate-700 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800">
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#e9f8f0] text-[#06c755] dark:bg-emerald-950 dark:text-emerald-400">
              <BadgeCheck className="h-5 w-5" />
            </div>
            <p className="font-kanit text-xl font-bold text-blue-950 dark:text-slate-100">ศูนย์บริการลูกค้าใน LINE</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              ดูบิล ชำระเงิน ประกัน และเคลมของคุณได้จากที่นี่
            </p>
          </div>
          <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
            <div className="flex gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-sky-400" />
              <span>ดูบิลและประวัติการซื้อของคุณ</span>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-sky-400" />
              <span>ตรวจประกันและประวัติการเคลม</span>
            </div>
            <div className="flex gap-3">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-sky-400" />
              <span>เปิดใบเสร็จหรือใบแจ้งหนี้ได้ทุกเมื่อ</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, "1");
              setShouldShow(false);
            }}
            className="mt-6 w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/20 dark:bg-sky-700 dark:shadow-sky-900/20"
          >
            เริ่มใช้งาน
          </button>
        </div>
      </div>
    </div>
  );
}
