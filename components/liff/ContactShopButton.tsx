"use client";

import { MessageCircle } from "lucide-react";

export default function ContactShopButton() {
  const handleClick = () => {
    if (window.liff) {
      window.liff.closeWindow();
      return;
    }

    window.location.href = "https://lin.ee/18P0SqG";
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#06c755] text-white shadow-lg shadow-emerald-900/20 transition hover:bg-[#05b44d]"
      aria-label="ติดต่อร้าน"
    >
      <MessageCircle size={22} />
    </button>
  );
}
