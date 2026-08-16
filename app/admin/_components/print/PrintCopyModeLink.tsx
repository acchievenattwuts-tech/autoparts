"use client";

import { Printer } from "lucide-react";
import { useState } from "react";

import PrintCopyModeSwitch from "./PrintCopyModeSwitch";
import { buildPrintHrefWithCopyMode, type PrintCopyMode } from "./print-copies";

/**
 * สำหรับหน้าที่ "ปุ่มพิมพ์คือการนำทาง" ไปหน้าพิมพ์พร้อม `?print=1`
 * (ฟอร์มแก้ไข, แบนเนอร์บันทึกสำเร็จ, คิวจัดส่ง, หน้ารายละเอียดใบเคลม)
 *
 * สวิตช์ไม่เขียน `data-print-copies` บนหน้านี้ เพราะหน้านี้ไม่ใช่เป้าหมายการพิมพ์ —
 * แต่ต่อ `copies=2` เข้า href แทน แล้วปลายทาง (PrintCopyModeToggle + AutoPrint)
 * เป็นคนอ่านกลับมาตั้งค่าให้
 */
const PrintCopyModeLink = ({
  href,
  label,
  className,
  iconSize = 16,
  groupClassName = "inline-flex items-center gap-2",
}: {
  /** href ฐาน (ยังไม่มี `copies`) เช่น `/admin/sales/abc?print=1` */
  href: string;
  label: string;
  /** class ของตัวปุ่มพิมพ์ — ส่งของเดิมของแต่ละหน้าเข้ามาเพื่อไม่ให้หน้าตาเปลี่ยน */
  className: string;
  iconSize?: number;
  groupClassName?: string;
}) => {
  const [mode, setMode] = useState<PrintCopyMode>("ORIGINAL");

  return (
    <div className={groupClassName}>
      <PrintCopyModeSwitch value={mode} onChange={setMode} />
      <a
        href={buildPrintHrefWithCopyMode(href, mode)}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        <Printer size={iconSize} /> {label}
      </a>
    </div>
  );
};

export default PrintCopyModeLink;
