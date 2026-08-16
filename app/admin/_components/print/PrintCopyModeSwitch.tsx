"use client";

import { PRINT_COPY_MODE_OPTIONS, type PrintCopyMode } from "./print-copies";

/**
 * สวิตช์ "ต้นฉบับ | ต้นฉบับ+สำเนา" แบบ controlled — ไม่มี side effect ใดๆ
 * ให้ผู้เรียกเป็นคนตัดสินใจว่าจะเอาค่าไปเขียน `data-print-copies` (หน้าพิมพ์)
 * หรือเอาไปต่อท้าย href ของปุ่มพิมพ์ (หน้าที่ต้องนำทางไปพิมพ์)
 */
const PrintCopyModeSwitch = ({
  value,
  onChange,
}: {
  value: PrintCopyMode;
  onChange: (mode: PrintCopyMode) => void;
}) => (
  <div
    role="group"
    aria-label="จำนวนชุดที่พิมพ์"
    className="no-print inline-flex items-center gap-0.5 rounded-lg border border-gray-300 p-0.5 dark:border-white/20"
  >
    {PRINT_COPY_MODE_OPTIONS.map((option) => {
      const isActive = option.value === value;

      return (
        <button
          key={option.value}
          type="button"
          aria-pressed={isActive}
          onClick={() => onChange(option.value)}
          className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
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

export default PrintCopyModeSwitch;
