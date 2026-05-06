"use client";

import { Printer } from "lucide-react";
import { printWhenReady } from "@/components/shared/print-assets";

const PrintButton = ({ label = "พิมพ์ใบเสร็จ" }: { label?: string }) => {
  return (
    <button
      onClick={() => void printWhenReady()}
      className="no-print inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors"
    >
      <Printer size={16} /> {label}
    </button>
  );
};

export default PrintButton;
