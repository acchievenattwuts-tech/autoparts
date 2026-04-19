type NumericLike = number | string | { toString(): string };

import { formatDateThai } from "@/lib/th-date";

export type { NumericLike };

export type PrintShopConfig = {
  shopName?: string | null;
  shopAddress?: string | null;
  shopPhone?: string | null;
  shopLogoUrl?: string | null;
  shopWebsiteUrl?: string | null;
  shopLineId?: string | null;
  printNoticeText?: string | null;
};

export const PRINT_HEADER_BORDER_CLASS = "border-gray-400";
export const PRINT_BODY_BORDER_CLASS = "border-gray-300";
export const PRINT_HEADER_CELL_CLASS = `border ${PRINT_HEADER_BORDER_CLASS} px-1.5 py-1.5`;
export const PRINT_TABLE_CELL_CLASS = `border ${PRINT_BODY_BORDER_CLASS} px-1.5 py-1.5`;
export const PRINT_SECTION_BORDER_CLASS = `border ${PRINT_BODY_BORDER_CLASS}`;
export const PRINT_SECTION_BOTTOM_BORDER_CLASS = `border-b ${PRINT_BODY_BORDER_CLASS}`;
export const PRINT_SECTION_TOP_BORDER_CLASS = `border-t ${PRINT_BODY_BORDER_CLASS}`;

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"] as const;
const THAI_POSITIONS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"] as const;

export const formatPrintDate = (value: Date | string) => formatDateThai(value);

export const formatPrintNumber = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function convertThaiIntegerPart(value: number): string {
  if (value === 0) return THAI_DIGITS[0];

  let result = "";
  const digits = String(value);

  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    if (digit === 0) continue;

    const position = digits.length - index - 1;

    if (position >= 6) {
      const millions = Math.floor(value / 1_000_000);
      const remainder = value % 1_000_000;
      return `${convertThaiIntegerPart(millions)}ล้าน${remainder > 0 ? convertThaiIntegerPart(remainder) : ""}`;
    }

    if (position === 0 && digit === 1 && digits.length > 1) {
      result += "เอ็ด";
      continue;
    }

    if (position === 1) {
      if (digit === 1) {
        result += "สิบ";
        continue;
      }

      if (digit === 2) {
        result += "ยี่สิบ";
        continue;
      }
    }

    result += `${THAI_DIGITS[digit]}${THAI_POSITIONS[position]}`;
  }

  return result;
}

export function formatThaiBahtText(value: number): string {
  if (!Number.isFinite(value)) return "";

  const normalized = Math.round(value * 100) / 100;
  const baht = Math.floor(normalized);
  const satang = Math.round((normalized - baht) * 100);
  const bahtText = `${convertThaiIntegerPart(baht)}บาท`;

  if (satang === 0) {
    return `${bahtText}ถ้วน`;
  }

  return `${bahtText}${convertThaiIntegerPart(satang)}สตางค์`;
}

export const getPrintNoticeLines = (text?: string | null) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
