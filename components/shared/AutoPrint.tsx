"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  PRINT_COPIES_PARAM,
  parsePrintCopyMode,
  printCopyModeToAttributeValue,
} from "@/app/admin/_components/print/print-copies";
import { printWhenReady } from "./print-assets";

const AutoPrint = () => {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("print") === "1") {
      // ปุ่มพิมพ์ของหน้าอื่นส่งจำนวนชุดมาทาง query — ตั้งค่าให้ print stylesheet
      // ก่อนสั่งพิมพ์ เพื่อให้ลิงก์พิมพ์ทำงานถูกแม้หน้าปลายทางจะไม่มี toggle
      document.documentElement.dataset.printCopies = printCopyModeToAttributeValue(
        parsePrintCopyMode(searchParams.get(PRINT_COPIES_PARAM)),
      );

      const timer = setTimeout(() => {
        void printWhenReady();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  return null;
};

export default AutoPrint;
