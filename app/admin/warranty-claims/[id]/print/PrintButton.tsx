"use client";

import { Printer } from "lucide-react";

const PrintButton = () => (
  <button
    onClick={() => window.print()}
    className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors ml-auto"
  >
    <Printer size={15} /> พิมพ์
  </button>
);

export default PrintButton;
