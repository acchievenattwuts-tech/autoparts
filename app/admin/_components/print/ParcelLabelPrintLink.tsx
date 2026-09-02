"use client";

import { Tag } from "lucide-react";
import { useSyncExternalStore } from "react";

import { PARCEL_LABEL_SIZE_OPTIONS, PARCEL_LABEL_SIZE_PARAM } from "./parcel-label";
import {
  getParcelLabelSizeServerSnapshot,
  getParcelLabelSizeSnapshot,
  rememberParcelLabelSize,
  subscribeParcelLabelSize,
} from "./parcel-label-preference";

const DEFAULT_LINK_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600";
const DISABLED_CLASS =
  "inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-sm text-gray-400 dark:bg-white/10 dark:text-slate-500";

/**
 * สวิตช์ A5 / A4 + ปุ่มพิมพ์ใบปะหน้ากล่อง ใช้ร่วมกันทั้งคิวจัดส่งและหน้าใบขาย
 *
 * ขนาดกระดาษถูกส่งไปทาง query เพราะ `@page { size: ... }` ต้องถูกเรนเดอร์จาก
 * เซิร์ฟเวอร์ และค่าที่เลือกล่าสุดถูกจำไว้ในเครื่องเพื่อไม่ต้องเลือกซ้ำทุกครั้ง
 */
const ParcelLabelPrintLink = ({
  ids,
  label,
  showCount = false,
  disabledTitle = "ยังไม่มีบิลที่พิมพ์ใบปะหน้ากล่องได้",
  className = DEFAULT_LINK_CLASS,
}: {
  ids: string[];
  label: string;
  showCount?: boolean;
  disabledTitle?: string;
  className?: string;
}) => {
  const size = useSyncExternalStore(
    subscribeParcelLabelSize,
    getParcelLabelSizeSnapshot,
    getParcelLabelSizeServerSnapshot,
  );

  const isDisabled = ids.length === 0;
  const href = `/admin/delivery/labels?ids=${ids.join(
    ",",
  )}&${PARCEL_LABEL_SIZE_PARAM}=${size}&print=1`;
  const buttonLabel = showCount ? `${label} (${ids.length})` : label;

  return (
    <div className="inline-flex items-center gap-2">
      <div
        role="group"
        aria-label="ขนาดกระดาษใบปะหน้ากล่อง"
        className="inline-flex items-center gap-0.5 rounded-lg border border-gray-300 p-0.5 dark:border-white/20"
      >
        {PARCEL_LABEL_SIZE_OPTIONS.map((option) => {
          const isActive = option.value === size;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => rememberParcelLabelSize(option.value)}
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

      {isDisabled ? (
        <span className={DISABLED_CLASS} title={disabledTitle} aria-disabled="true">
          <Tag size={14} /> {buttonLabel}
        </span>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
          <Tag size={14} /> {buttonLabel}
        </a>
      )}
    </div>
  );
};

export default ParcelLabelPrintLink;
