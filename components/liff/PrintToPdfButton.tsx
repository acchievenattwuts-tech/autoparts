"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { printWhenReady } from "@/components/shared/print-assets";

export default function PrintToPdfButton({
  label = "บันทึก PDF",
  externalUrl,
}: {
  label?: string;
  externalUrl?: string | null;
}) {
  const [shouldOpenExternal, setShouldOpenExternal] = useState(false);

  useEffect(() => {
    setShouldOpenExternal(
      Boolean(externalUrl) && window.liff?.isInClient?.() === true && typeof window.liff?.openWindow === "function",
    );
  }, [externalUrl]);

  const handleClick = async () => {
    if (shouldOpenExternal && externalUrl && window.liff?.openWindow) {
      window.liff.openWindow({ url: externalUrl, external: true });
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
