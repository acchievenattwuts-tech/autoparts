"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { printWhenReady } from "@/components/shared/print-assets";

export default function PrintToPdfButton({ label = "บันทึก PDF" }: { label?: string }) {
  const [shouldOpenExternal, setShouldOpenExternal] = useState(false);

  useEffect(() => {
    setShouldOpenExternal(window.liff?.isInClient?.() === true && typeof window.liff?.openWindow === "function");
  }, []);

  const handleClick = async () => {
    if (shouldOpenExternal && window.liff?.openWindow) {
      window.liff.openWindow({ url: window.location.href, external: true });
      return;
    }

    await printWhenReady();
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-800 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-900 active:scale-[0.98]"
    >
      <Download size={16} />
      {shouldOpenExternal ? "เปิดเพื่อบันทึก PDF" : label}
    </button>
  );
}
