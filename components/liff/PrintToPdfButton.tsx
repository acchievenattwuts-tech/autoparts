"use client";

import { Download } from "lucide-react";

export default function PrintToPdfButton({ label = "บันทึก PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-950/20 transition hover:bg-slate-800 active:scale-[0.98]"
    >
      <Download size={16} />
      {label}
    </button>
  );
}
