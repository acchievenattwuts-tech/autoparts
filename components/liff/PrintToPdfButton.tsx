"use client";

import { Download } from "lucide-react";
import { useSyncExternalStore } from "react";
import { printWhenReady } from "@/components/shared/print-assets";

const subscribe = () => () => {};

const getShouldOpenExternal = (externalUrl?: string | null): boolean => {
  if (!externalUrl || typeof window === "undefined") return false;
  return window.liff?.isInClient?.() === true && typeof window.liff?.openWindow === "function";
};

export default function PrintToPdfButton({
  label = "บันทึก PDF",
  externalUrl,
}: {
  label?: string;
  externalUrl?: string | null;
}) {
  const shouldOpenExternal = useSyncExternalStore(
    subscribe,
    () => getShouldOpenExternal(externalUrl),
    () => false,
  );

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
