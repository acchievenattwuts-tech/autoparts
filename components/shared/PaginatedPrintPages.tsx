"use client";
import { useEffect, useRef, useState } from "react";
import { waitForPrintAssets } from "./print-assets";
import { paginatePrintSource } from "./print-pagination";

export default function PaginatedPrintPages() {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const output = ref.current;
    const root = output?.closest<HTMLElement>(".print-document-root");
    const source = root?.querySelector<HTMLElement>(":scope > .print-pagination-source");
    if (!output || !root || !source) return;
    let disposed = false;
    let revision = 0;
    const build = () => {
      try {
        paginatePrintSource(source, output);
        root.dataset.printReady = "true";
        root.removeAttribute("data-print-error"); setError("");
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "จัดหน้าเอกสารไม่สำเร็จ";
        root.dataset.printError = message; root.removeAttribute("data-print-ready"); setError(message);
      }
    };
    const prepare = async () => {
      const version = ++revision;
      root.removeAttribute("data-print-ready");
      await waitForPrintAssets({ root: source });
      if (!disposed && version === revision) build();
    };
    void prepare();
    const observer = new MutationObserver(() => void prepare());
    observer.observe(source, { childList: true, subtree: true, characterData: true, attributes: true });
    source.addEventListener("load", prepare, true);
    window.addEventListener("beforeprint", build);
    return () => { disposed = true; observer.disconnect(); source.removeEventListener("load", prepare, true); window.removeEventListener("beforeprint", build); };
  }, []);
  return <><div ref={ref} className="print-pagination-pages" />{error && <p role="alert" className="no-print p-4 text-red-700 dark:text-red-300">{error}</p>}</>;
}
