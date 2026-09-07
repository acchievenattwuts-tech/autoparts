"use client";
import { Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { waitForPrintDocument } from "./print-assets";

const PrintFromListButton = ({ href, label = "พิมพ์" }: { href: string; label?: string }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeFrame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => () => { activeFrame.current?.remove(); }, []);
  const handlePrint = async () => {
    if (activeFrame.current) return;
    setLoading(true);
    setError("");
    const frame = document.createElement("iframe");
    activeFrame.current = frame;
    frame.title = "เอกสารสำหรับพิมพ์";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;height:1400px;border:0;pointer-events:none";
    frame.src = href;
    document.body.appendChild(frame);
    const cleanup = () => {
      frame.remove();
      if (activeFrame.current === frame) activeFrame.current = null;
      setLoading(false);
    };
    try {
      await waitForPrintDocument(frame, href);
      if (activeFrame.current !== frame || !frame.isConnected) return;
      const target = frame.contentWindow;
      if (!target) throw new Error("ไม่สามารถเปิดเอกสารสำหรับพิมพ์ได้");
      target.addEventListener("afterprint", cleanup, { once: true });
      target.focus();
      target.print();
      // Keep the document alive until the print preview closes.
    } catch (reason) {
      cleanup();
      setError(reason instanceof Error ? reason.message : "ไม่สามารถพิมพ์เอกสารได้");
    }
  };
  return <span className="inline-flex flex-col items-end gap-1">
    <button type="button" onClick={() => void handlePrint()} disabled={loading}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200">
      <Printer size={14} />{loading ? "กำลังเตรียมพิมพ์..." : label}
    </button>
    {error && <span role="alert" className="max-w-64 text-xs text-red-600 dark:text-red-300">{error}</span>}
  </span>;
};
export default PrintFromListButton;
