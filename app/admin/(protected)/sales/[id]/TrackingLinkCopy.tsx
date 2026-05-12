"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface TrackingLinkCopyProps {
  path: string;
}

const TrackingLinkCopy = ({ path }: TrackingLinkCopyProps) => {
  const [copied, setCopied] = useState(false);

  const fullUrl =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  const handleCopy = async () => {
    const url =
      typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers where clipboard API fails
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Last resort: alert user to copy manually
        alert(`คัดลอกลิงก์นี้: ${url}`);
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="truncate font-mono text-xs text-blue-700">{fullUrl}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
      >
        {copied ? (
          <>
            <Check size={12} className="text-green-600" />
            <span className="text-green-600">คัดลอกแล้ว</span>
          </>
        ) : (
          <>
            <Copy size={12} />
            คัดลอก
          </>
        )}
      </button>
    </div>
  );
};

export default TrackingLinkCopy;
