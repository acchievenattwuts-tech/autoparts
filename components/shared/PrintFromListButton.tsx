"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { waitForPrintAssets } from "./print-assets";

interface Props {
  href: string;
  label?: string;
}

const PrintFromListButton = ({ href, label = "พิมพ์" }: Props) => {
  const [loading, setLoading] = useState(false);

  const handlePrint = () => {
    if (loading) return;
    setLoading(true);

    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(iframe);

    iframe.onload = () => {
      void (async () => {
        await waitForPrintAssets({ root: iframe.contentDocument });
        iframe.contentWindow?.print();
        setLoading(false);
      })();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 10000);
    };

    iframe.onerror = () => {
      setLoading(false);
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    };

    iframe.src = href;
  };

  return (
    <button
      type="button"
      onClick={handlePrint}
      disabled={loading}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200"
    >
      <Printer size={14} />
      {loading ? "กำลังโหลด..." : label}
    </button>
  );
};

export default PrintFromListButton;
