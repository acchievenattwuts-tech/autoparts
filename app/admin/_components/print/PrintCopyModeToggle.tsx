"use client";

import { useEffect, useState } from "react";

type PrintCopyMode = "ORIGINAL" | "WITH_COPY";

const MODE_OPTIONS: { value: PrintCopyMode; label: string }[] = [
  { value: "ORIGINAL", label: "ต้นฉบับ" },
  { value: "WITH_COPY", label: "ต้นฉบับ+สำเนา" },
];

/**
 * สลับจำนวนชุดที่จะพิมพ์ โดยเขียนค่าไว้ที่ `data-print-copies` บน <html>
 * ให้ print stylesheet ของแต่ละหน้าเป็นคนตัดสินใจว่าจะโชว์ใบสำเนาหรือไม่
 *
 * ค่าเริ่มต้นคือต้นฉบับอย่างเดียว และถ้า attribute ไม่ถูกตั้งเลย (เช่น กด Ctrl+P
 * ก่อน hydrate) print stylesheet จะ fallback เป็นต้นฉบับอย่างเดียวเช่นกัน
 */
const PrintCopyModeToggle = () => {
  const [mode, setMode] = useState<PrintCopyMode>("ORIGINAL");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.printCopies = mode === "WITH_COPY" ? "2" : "1";

    return () => {
      delete root.dataset.printCopies;
    };
  }, [mode]);

  return (
    <div
      role="group"
      aria-label="จำนวนชุดที่พิมพ์"
      className="no-print inline-flex items-center gap-0.5 rounded-lg border border-gray-300 p-0.5 dark:border-white/20"
    >
      {MODE_OPTIONS.map((option) => {
        const isActive = option.value === mode;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => setMode(option.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-[#1e3a5f] text-white dark:bg-sky-500 dark:text-slate-900"
                : "text-gray-600 hover:bg-gray-100 hover:text-[#1e3a5f] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-sky-300"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default PrintCopyModeToggle;
