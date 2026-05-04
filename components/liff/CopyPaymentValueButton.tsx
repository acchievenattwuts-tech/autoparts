"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

export default function CopyPaymentValueButton({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800 transition active:scale-[0.98]"
    >
      <Copy size={13} />
      {copied ? "คัดลอกแล้ว" : label}
    </button>
  );
}
