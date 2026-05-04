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
    <div className="fixed inset-0 z-50 bg-slate-950/45 px-5 py-8 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full max-w-sm items-center">
        <div className="w-full rounded-lg bg-white p-5 shadow-2xl">
          <div className="mb-5 rounded-lg bg-gradient-to-br from-teal-50 to-lime-50 p-4">
            <p className="font-kanit text-xl font-bold text-slate-950">บริการลูกค้าใน LINE</p>
            <p className="mt-1 text-sm text-slate-600">
              ดูข้อมูลสำคัญของคุณได้เร็วขึ้นจากบัญชี LINE นี้
            </p>
          </div>
          <div className="space-y-3 text-sm text-slate-700">
            <div className="flex gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <span>ดูบิลและประวัติการซื้อของคุณ</span>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <span>ตรวจประกันและประวัติการเคลม</span>
            </div>
            <div className="flex gap-3">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
              <span>เปิดใบเสร็จหรือใบแจ้งหนี้ได้ทุกเมื่อ</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, "1");
              setShouldShow(false);
            }}
            className="mt-6 w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white"
          >
            เริ่มใช้งาน
          </button>
        </div>
      </div>
    </div>
  );
}
