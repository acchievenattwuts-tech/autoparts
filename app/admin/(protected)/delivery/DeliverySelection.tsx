"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";

import ParcelLabelPrintLink from "@/app/admin/_components/print/ParcelLabelPrintLink";
import PrintCopyModeSwitch from "@/app/admin/_components/print/PrintCopyModeSwitch";
import {
  buildPrintHrefWithCopyMode,
  type PrintCopyMode,
} from "@/app/admin/_components/print/print-copies";

export type DeliveryRow = {
  id: string;
  /** ใบขาย Shopee / Lazada พิมพ์ใบส่งของได้ แต่ไม่พิมพ์ใบปะหน้ากล่อง */
  canPrintLabel: boolean;
};

type DeliverySelectionValue = {
  rows: DeliveryRow[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setAll: (next: boolean) => void;
  /** id ที่เลือกไว้ เรียงตามลำดับที่แสดงบนตาราง */
  selectedIds: string[];
  selectedLabelIds: string[];
};

const DeliverySelectionContext = createContext<DeliverySelectionValue | null>(null);

const useDeliverySelection = (): DeliverySelectionValue => {
  const value = useContext(DeliverySelectionContext);
  if (!value) throw new Error("ต้องใช้ภายใน DeliverySelectionProvider");
  return value;
};

/**
 * สถานะ "บิลที่ติ๊กเลือก" ของคิวจัดส่ง ใช้ร่วมกันระหว่างช่องติ๊กในตารางกับปุ่มพิมพ์
 *
 * ตัวตารางยังเป็น Server Component เหมือนเดิม — provider นี้ห่อไว้เฉยๆ แล้วแทรก
 * เฉพาะ client component ชิ้นเล็ก (ช่องติ๊ก + ปุ่มพิมพ์) ลงไป จึงไม่ได้ย้าย
 * การ query หรือ logic ใดๆ มาฝั่ง client
 */
export const DeliverySelectionProvider = ({
  rows,
  children,
}: {
  rows: DeliveryRow[];
  children: ReactNode;
}) => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());

  const value = useMemo<DeliverySelectionValue>(() => {
    // กรองด้วย rows เสมอ เพื่อให้ id ที่หลุดออกจากผลการกรองแล้วไม่ถูกนับต่อ
    const selectedIds = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
    const selectedLabelIds = rows
      .filter((row) => row.canPrintLabel && selected.has(row.id))
      .map((row) => row.id);

    return {
      rows,
      selectedIds,
      selectedLabelIds,
      isSelected: (id) => selected.has(id),
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setAll: (next) => setSelected(next ? new Set(rows.map((row) => row.id)) : new Set<string>()),
    };
  }, [rows, selected]);

  return (
    <DeliverySelectionContext.Provider value={value}>{children}</DeliverySelectionContext.Provider>
  );
};

const CHECKBOX_CLASS =
  "h-4 w-4 cursor-pointer rounded border-gray-300 text-[#1e3a5f] accent-[#1e3a5f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a5f] dark:border-white/25 dark:accent-sky-500 dark:focus-visible:outline-sky-400";

export const DeliveryRowCheckbox = ({ id, saleNo }: { id: string; saleNo: string }) => {
  const { isSelected, toggle } = useDeliverySelection();

  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={isSelected(id)}
      onChange={() => toggle(id)}
      aria-label={`เลือกใบขาย ${saleNo}`}
    />
  );
};

export const DeliverySelectAllCheckbox = () => {
  const { rows, selectedIds, setAll } = useDeliverySelection();
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={allSelected}
      ref={(node) => {
        if (node) node.indeterminate = someSelected;
      }}
      disabled={rows.length === 0}
      onChange={() => setAll(!allSelected)}
      aria-label="เลือกทั้งหน้า"
    />
  );
};

const NOTE_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600";
const NOTE_BUTTON_DISABLED_CLASS =
  "inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-sm text-gray-400 dark:bg-white/10 dark:text-slate-500";

/**
 * ปุ่มพิมพ์ทั้งสองใบของคิวจัดส่ง — ทำงานกับ "บิลที่ติ๊กเลือก" ชุดเดียวกัน
 * ไม่ได้ติ๊กอะไรเลย ปุ่มจะกดไม่ได้ (ติ๊กหัวตารางเลือกทั้งหน้าได้ในคลิกเดียว)
 */
export const DeliveryPrintActions = () => {
  const { selectedIds, selectedLabelIds } = useDeliverySelection();
  const [copyMode, setCopyMode] = useState<PrintCopyMode>("ORIGINAL");

  const noteHref = buildPrintHrefWithCopyMode(
    `/admin/delivery/print?ids=${selectedIds.join(",")}&print=1`,
    copyMode,
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <div className="flex items-center gap-2">
        <PrintCopyModeSwitch value={copyMode} onChange={setCopyMode} />
        {selectedIds.length === 0 ? (
          <span
            className={NOTE_BUTTON_DISABLED_CLASS}
            title="ติ๊กเลือกบิลที่ต้องการพิมพ์ก่อน"
            aria-disabled="true"
          >
            <Printer size={14} /> พิมพ์ใบส่งของ (0)
          </span>
        ) : (
          <a href={noteHref} target="_blank" rel="noopener noreferrer" className={NOTE_BUTTON_CLASS}>
            <Printer size={14} /> พิมพ์ใบส่งของ ({selectedIds.length})
          </a>
        )}
      </div>

      <ParcelLabelPrintLink
        ids={selectedLabelIds}
        label="พิมพ์ใบปะหน้ากล่อง"
        showCount
        disabledTitle={
          selectedIds.length === 0
            ? "ติ๊กเลือกบิลที่ต้องการพิมพ์ก่อน"
            : "บิลที่เลือกเป็นใบขาย Shopee / Lazada ซึ่งใช้ใบปะกล่องของแพลตฟอร์ม"
        }
      />
    </div>
  );
};
