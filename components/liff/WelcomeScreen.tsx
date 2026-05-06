"use client";

import { useState } from "react";
import { BadgeCheck, FileText, ShieldCheck } from "lucide-react";

const STORAGE_KEY = "liff_onboarded";

export default function WelcomeScreen() {
  const [shouldShow, setShouldShow] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) !== "1",
  );

  if (!shouldShow) return null;

  return (
    <div className="fixed inset-0 z-50 bg-blue-950/35 px-5 py-8 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full max-w-sm items-center">
        <div className="w-full rounded-2xl border border-blue-100 bg-white p-5 shadow-2xl shadow-blue-950/20">
          <div className="mb-5 rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 p-4">
            <p className="font-kanit text-xl font-bold text-blue-950">บริการลูกค้าใน LINE</p>
            <p className="mt-1 text-sm text-slate-600">
              ดูข้อมูลสำคัญของคุณได้เร็วขึ้นจากบัญชี LINE นี้
            </p>
          </div>
          <div className="space-y-3 text-sm text-slate-700">
            <div className="flex gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
              <span>ดูบิลและประวัติการซื้อของคุณ</span>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
              <span>ตรวจประกันและประวัติการเคลม</span>
            </div>
            <div className="flex gap-3">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
              <span>เปิดใบเสร็จหรือใบแจ้งหนี้ได้ทุกเมื่อ</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, "1");
              setShouldShow(false);
            }}
            className="mt-6 w-full rounded-xl bg-blue-800 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/20"
          >
            เริ่มใช้งาน
          </button>
        </div>
      </div>
    </div>
  );
}
