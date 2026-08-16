/**
 * จำนวนชุดที่จะพิมพ์ — ใช้ร่วมกันระหว่าง client toggle, print stylesheet และ URL
 *
 * ปุ่มพิมพ์หลายจุด (ฟอร์มแก้ไข, แบนเนอร์บันทึกสำเร็จ, คิวจัดส่ง) เป็นการ "นำทาง"
 * ไปหน้าพิมพ์พร้อม `?print=1` ทำให้ค่าที่เขียนไว้บน `<html>` ของหน้าเดิมหายไป
 * จึงต้องส่งค่าผ่าน query string แล้วให้ปลายทางอ่านกลับมาตั้งเป็น `data-print-copies`
 *
 * โมดูลนี้ตั้งใจไม่ import อะไรเลย เพื่อให้ปลอดภัยทั้งฝั่ง server และ client bundle
 */
export type PrintCopyMode = "ORIGINAL" | "WITH_COPY";

export const PRINT_COPIES_PARAM = "copies";
export const PRINT_COPIES_WITH_COPY_VALUE = "2";
export const PRINT_COPIES_ORIGINAL_VALUE = "1";

export const PRINT_COPY_MODE_OPTIONS: { value: PrintCopyMode; label: string }[] = [
  { value: "ORIGINAL", label: "ต้นฉบับ" },
  { value: "WITH_COPY", label: "ต้นฉบับ+สำเนา" },
];

/** แปลงค่าจาก query string เป็นโหมด — ค่าอื่นหรือไม่มีค่า = ต้นฉบับอย่างเดียว */
export const parsePrintCopyMode = (value: string | null | undefined): PrintCopyMode =>
  value === PRINT_COPIES_WITH_COPY_VALUE ? "WITH_COPY" : "ORIGINAL";

export const printCopyModeToAttributeValue = (mode: PrintCopyMode) =>
  mode === "WITH_COPY" ? PRINT_COPIES_WITH_COPY_VALUE : PRINT_COPIES_ORIGINAL_VALUE;

/**
 * ต่อ `copies=2` เข้ากับ href ของปุ่มพิมพ์ — ต่อสตริงตรงๆ แทนการ parse URL
 * เพราะ href เหล่านี้เป็น path สัมพัทธ์ และไม่มีที่ไหนใส่ `copies` มาก่อนอยู่แล้ว
 */
export const buildPrintHrefWithCopyMode = (href: string, mode: PrintCopyMode) => {
  if (mode !== "WITH_COPY") return href;

  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${PRINT_COPIES_PARAM}=${PRINT_COPIES_WITH_COPY_VALUE}`;
};
