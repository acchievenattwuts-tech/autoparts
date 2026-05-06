"use client";

import { Printer } from "lucide-react";
import { printWhenReady } from "@/components/shared/print-assets";

const PrintButton = () => (
  <button
    onClick={() => void printWhenReady()}
    className="px-4 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#162d4a]"
  >
    <Printer size={14} className="inline mr-1.5" />
    พิมพ์ทั้งหมด
  </button>
);

export default PrintButton;
