"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import PrintCopyModeSwitch from "./PrintCopyModeSwitch";
import {
  PRINT_COPIES_PARAM,
  parsePrintCopyMode,
  printCopyModeToAttributeValue,
  type PrintCopyMode,
} from "./print-copies";

const PrintCopyModeToggleInner = () => {
  const searchParams = useSearchParams();
  // อ่านค่าเริ่มต้นตอน render (ไม่ใช่ใน effect) เพื่อให้ server กับ client ตรงกัน
  // และไม่เกิด cascading render
  const [mode, setMode] = useState<PrintCopyMode>(() =>
    parsePrintCopyMode(searchParams.get(PRINT_COPIES_PARAM)),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.printCopies = printCopyModeToAttributeValue(mode);

    return () => {
      delete root.dataset.printCopies;
    };
  }, [mode]);

  return <PrintCopyModeSwitch value={mode} onChange={setMode} />;
};

/**
 * สำหรับ "หน้าพิมพ์" (sales/receipts detail, delivery batch print, warranty claim print)
 * เขียนค่าไว้ที่ `data-print-copies` บน <html> ให้ print stylesheet เป็นคนตัดสินใจ
 *
 * ค่าเริ่มต้นคือต้นฉบับอย่างเดียว แต่ถ้าเข้ามาด้วย `?copies=2` (มาจากปุ่มพิมพ์ของ
 * หน้าอื่นที่นำทางมา หรือ iframe ของ PrintFromListButton) จะ sync ให้ตรงกับที่
 * ผู้ใช้เลือกไว้ก่อนหน้า
 *
 * ครอบ Suspense ไว้ในตัวเอง เพื่อให้หน้าที่เรียกใช้ไม่ต้องจัดการ boundary เอง
 */
const PrintCopyModeToggle = () => (
  <Suspense fallback={null}>
    <PrintCopyModeToggleInner />
  </Suspense>
);

export default PrintCopyModeToggle;
