"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";

import { useLiff } from "./LiffProvider";

export default function LiffGate({ children }: { children: React.ReactNode }) {
  const { isReady, error } = useLiff();

  if (!isReady) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center px-6 text-center">
        <div>
          <LoaderCircle className="mx-auto mb-3 h-7 w-7 animate-spin text-blue-700" />
          <p className="text-sm font-medium text-slate-700">กำลังเปิดบริการลูกค้า LINE</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-sm px-5 py-10 text-center">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-rose-800 shadow-sm">
          <p className="font-semibold">เปิดบริการไม่สำเร็จ</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
        <Link
          href="https://lin.ee/18P0SqG"
          className="mt-4 inline-flex rounded-xl bg-blue-800 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-900/20"
        >
          ติดต่อร้าน
        </Link>
      </div>
    );
  }

  return children;
}
