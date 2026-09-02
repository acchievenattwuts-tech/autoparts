/**
 * ค่ากลางของ "ใบปะหน้ากล่องพัสดุ" — ใช้ร่วมกันระหว่างหน้าพิมพ์กับตัวเอกสาร
 *
 * ใบมีเลย์เอาต์เดียวใช้ได้ทั้ง A5 และ A4 เพราะกระดาษมาตรฐาน ISO A ทุกขนาดมี
 * สัดส่วนด้านเท่ากัน (√2) — A5 แนวนอน 210×148 กับ A4 แนวนอน 297×210 ต่างกัน
 * แค่ 0.3% ทุกอย่างในใบจึงกำหนดเป็น `em` แล้วปล่อยให้ `baseFontMm` ของแต่ละ
 * ขนาดเป็นตัวขยาย ไม่ต้องดูแลเลย์เอาต์สองชุด
 *
 * โมดูลนี้ตั้งใจไม่ import อะไรเลย เพื่อให้ใช้ได้ทั้งฝั่ง server และ client
 */

export type ParcelLabelSize = "A5" | "A4";

export const PARCEL_LABEL_SIZE_PARAM = "size";
export const PARCEL_LABEL_DEFAULT_SIZE: ParcelLabelSize = "A5";

/** เพดานจำนวนใบต่อการพิมพ์หนึ่งครั้ง — เท่ากับหน้าพิมพ์ใบส่งของเดิม */
export const PARCEL_LABEL_MAX_IDS = 100;

export type ParcelLabelSizeConfig = {
  /** ความกว้างจริงบนกระดาษ (มม.) — ใช้ทั้งตอนพิมพ์และตอนพรีวิวบนจอ */
  widthMm: number;
  heightMm: number;
  /** ขนาดตัวอักษรฐานของใบ ทุกอย่างข้างในอ้างอิงเป็น `em` จากค่านี้ */
  baseFontMm: number;
  /** ค่าที่ใส่ใน `@page { size: ... }` */
  pageSize: string;
  label: string;
};

export const PARCEL_LABEL_SIZE_CONFIG: Record<ParcelLabelSize, ParcelLabelSizeConfig> = {
  A5: { widthMm: 210, heightMm: 148, baseFontMm: 4.4, pageSize: "A5 landscape", label: "A5 แนวนอน" },
  A4: { widthMm: 297, heightMm: 210, baseFontMm: 6.2, pageSize: "A4 landscape", label: "A4 แนวนอน" },
};

export const PARCEL_LABEL_SIZE_OPTIONS: { value: ParcelLabelSize; label: string }[] = [
  { value: "A5", label: "A5" },
  { value: "A4", label: "A4" },
];

/** แปลงค่าจาก query string เป็นขนาดกระดาษ — ค่าอื่นหรือไม่มีค่า = A5 */
export const parseParcelLabelSize = (value: string | null | undefined): ParcelLabelSize =>
  value === "A4" ? "A4" : PARCEL_LABEL_DEFAULT_SIZE;

/**
 * จำนวนตัวอักษรโดยประมาณที่ที่อยู่หนึ่งบรรทัดรับได้ ตอนยังไม่ย่อ
 * (กรอบผู้รับกว้างราว 180 มม. ตัวอักษร 5.3 มม. อักษรไทยกว้างเฉลี่ยราวครึ่งหนึ่ง)
 * ตั้งไว้ต่ำกว่าที่คำนวณได้จริงเล็กน้อยเพื่อให้เผื่อไว้ก่อน
 */
const CHARS_PER_RECIPIENT_LINE = 60;

/** จำนวนบรรทัด (ชื่อ + ที่อยู่) ที่กรอบผู้รับรองรับได้โดยไม่ต้องย่อ */
const RECIPIENT_LINES_AT_FULL_SCALE = 6;

/**
 * ขั้นการย่อตัวอักษรของกรอบผู้รับ — เกินมา 1 บรรทัดลด 1 ขั้น
 * ขั้นต่ำสุด 0.6 เท่า (ราว 3.2 มม. บน A5) ยังอ่านออกชัดบนกล่อง
 * เลือกย่อแทนการตัดท้ายด้วย "…" เพราะที่อยู่ที่ขาดท่อนอาจทำให้ส่งไม่ถึง
 */
const RECIPIENT_SCALE_STEPS = [1, 0.92, 0.84, 0.76, 0.68, 0.6] as const;

/** นับจำนวนบรรทัดหลังตัดขึ้นบรรทัดใหม่เอง รวมบรรทัดที่จะถูกตัดคำโดยเบราว์เซอร์ */
export function countWrappedLines(text: string, charsPerLine: number): number {
  if (charsPerLine <= 0) return 0;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/**
 * เลือกอัตราย่อของกรอบผู้รับจากความยาวชื่อ + ที่อยู่
 *
 * คำนวณฝั่งเซิร์ฟเวอร์โดยตั้งใจ — หน้าพิมพ์เรียก `window.print()` อัตโนมัติ
 * ทันทีที่ฟอนต์โหลดเสร็จ ถ้าย่อด้วย JavaScript หลังเรนเดอร์ กล่องพิมพ์อาจเด้ง
 * ขึ้นมาก่อนย่อเสร็จแล้วได้ใบที่ตัวอักษรล้น
 */
export function resolveRecipientTextScale({
  name,
  address,
}: {
  name: string;
  address: string;
}): number {
  const usedLines =
    countWrappedLines(name, CHARS_PER_RECIPIENT_LINE) +
    countWrappedLines(address, CHARS_PER_RECIPIENT_LINE);

  const overflowLines = usedLines - RECIPIENT_LINES_AT_FULL_SCALE;
  if (overflowLines <= 0) return RECIPIENT_SCALE_STEPS[0];

  const stepIndex = Math.min(overflowLines, RECIPIENT_SCALE_STEPS.length - 1);
  return RECIPIENT_SCALE_STEPS[stepIndex];
}
