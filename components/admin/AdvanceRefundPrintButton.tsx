"use client";

import { Printer } from "lucide-react";
import { printWhenReady } from "@/components/shared/print-assets";

export default function AdvanceRefundPrintButton() {
  return (
    <button
      type="button"
      onClick={() => void printWhenReady()}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600"
    >
      <Printer size={14} /> พิมพ์ใบคืนเงินมัดจำ
    </button>
  );
}
