"use client";

import { MessageCircle } from "lucide-react";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

const hasPrintTokenParam = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).has("printToken");
};

export default function ContactShopButton({ lineUrl = "" }: { lineUrl?: string }) {
  const isPrintTokenRequest = useSyncExternalStore(subscribe, hasPrintTokenParam, () => false);

  if (isPrintTokenRequest) {
    return null;
  }

  const handleClick = () => {
    if (window.liff) {
      window.liff.closeWindow();
      return;
    }

    if (lineUrl) window.location.href = lineUrl;
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-[max(1rem,calc((100vw-28rem)/2+1rem))] z-[1100] inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#06c755] text-white ring-4 ring-white shadow-xl shadow-emerald-900/20 transition hover:bg-[#05b44d] active:scale-95"
      aria-label="ติดต่อร้าน"
    >
      <MessageCircle size={22} />
    </button>
  );
}
