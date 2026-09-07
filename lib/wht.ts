import { z } from "zod";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * ภาษีเงินได้หัก ณ ที่จ่าย — helper กลางที่ใช้ร่วมกันทั้งฝั่งรับ (ถูกลูกค้าหัก)
 * และฝั่งจ่าย (เราหักผู้รับเงินแล้วออกหนังสือรับรอง 50 ทวิ)
 *
 * ตั้งใจไม่แตะ `assertPaymentsMatchTotal` ใน lib/document-payments.ts เพราะฟังก์ชันนั้น
 * ใช้ร่วมกัน 11 ประเภทเอกสาร — เอกสารที่มีภาษีหัก ณ ที่จ่ายจะส่งยอด "เงินที่รับจริง"
 * (ยอดเอกสาร − ภาษีที่ถูกหัก) เข้าไปแทน เพื่อให้พฤติกรรมของโมดูลอื่นเหมือนเดิมทุกประการ
 */

/** พ.ศ. = ค.ศ. + 543 — แบบและไฟล์นำส่งกรมสรรพากรใช้ปี พ.ศ. 4 หลักเสมอ */
export const BUDDHIST_ERA_OFFSET = 543;

const AMOUNT_EPSILON = 0.005;

/** ปัดเป็นทศนิยม 2 ตำแหน่งแบบเดียวกับยอดเงินอื่นในระบบ */
export function roundAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** คำนวณภาษีจากฐานภาษีและอัตรา (ร้อยละ) */
export function calculateWhtTax(baseAmount: number, ratePercent: number): number {
  return roundAmount((baseAmount * ratePercent) / 100);
}

/** ปีภาษี พ.ศ. ตามวันที่จ่ายเงิน (อิงวันตามเวลาประเทศไทย) */
export function toThaiTaxYear(payDate: Date): number {
  const [year] = getThailandDateKey(payDate).split("-");
  return Number(year) + BUDDHIST_ERA_OFFSET;
}

/** เดือนภาษี 1-12 ตามวันที่จ่ายเงิน (อิงวันตามเวลาประเทศไทย) */
export function toThaiTaxMonth(payDate: Date): number {
  const [, month] = getThailandDateKey(payDate).split("-");
  return Number(month);
}

/**
 * ครึ่งปีภาษี — 1 = ม.ค.-มิ.ย. (ยอดที่นำไปเครดิตใน ภ.ง.ด.94), 2 = ก.ค.-ธ.ค.
 * บุคคลธรรมดาที่มีเงินได้ 40(5)-(8) ต้องยื่น ภ.ง.ด.94 ภายในเดือนกันยายน
 */
export function toThaiTaxHalf(payDate: Date): 1 | 2 {
  return toThaiTaxMonth(payDate) <= 6 ? 1 : 2;
}

export interface WhtReceivedInput {
  incomeTypeId: string;
  baseAmount: number;
  rate: number;
  taxAmount: number;
  certNo: string | null;
  certDate: string | null;
}

/**
 * ฟอร์มส่งค่าภาษีหัก ณ ที่จ่ายมาเป็น JSON ก้อนเดียว (`wht`) — ว่างหรือ null แปลว่าใบนี้ไม่ถูกหัก
 * ยอดภาษีเป็นค่าที่ผู้ใช้ยืนยันเอง ไม่บังคับให้เท่ากับฐาน x อัตรา เป๊ะ ๆ
 * เพราะหนังสือรับรองที่ลูกค้าออกมาจริงอาจปัดเศษต่างจากเรา
 */
export const whtReceivedInputSchema = z.object({
  incomeTypeId: z.string().min(1, "กรุณาเลือกประเภทเงินได้"),
  baseAmount: z.coerce.number().min(0, "ฐานภาษีต้องไม่ติดลบ"),
  rate: z.coerce.number().min(0, "อัตราภาษีต้องไม่ติดลบ").max(100, "อัตราภาษีต้องไม่เกิน 100"),
  taxAmount: z.coerce.number().gt(0, "ยอดภาษีหัก ณ ที่จ่ายต้องมากกว่า 0"),
  certNo: z.string().max(50).nullish().transform((value) => value?.trim() || null),
  certDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ในหนังสือรับรองไม่ถูกต้อง")
    .nullish()
    .transform((value) => value || null),
});

/** อ่านค่าภาษีหัก ณ ที่จ่ายจาก FormData — คืน null เมื่อใบนั้นไม่มียอดหัก */
export function parseWhtReceivedField(
  raw: FormDataEntryValue | null,
): { success: true; data: WhtReceivedInput | null } | { success: false; error: string } {
  if (typeof raw !== "string" || raw.trim() === "" || raw === "null") {
    return { success: true, data: null };
  }

  try {
    const parsed = whtReceivedInputSchema.parse(JSON.parse(raw));
    return { success: true, data: { ...parsed, taxAmount: roundAmount(parsed.taxAmount) } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "ข้อมูลภาษีหัก ณ ที่จ่ายไม่ถูกต้อง" };
    }
    return { success: false, error: "ข้อมูลภาษีหัก ณ ที่จ่ายไม่ถูกต้อง" };
  }
}

/**
 * ตรวจความถูกต้องเชิงธุรกิจของยอดหัก ณ ที่จ่ายเทียบกับยอดเอกสาร
 * คืนข้อความภาษาไทยเมื่อไม่ผ่าน และคืน null เมื่อผ่าน
 */
export function validateWhtAgainstTotal(
  wht: WhtReceivedInput | null,
  totalAmount: number,
  options: { hasCustomer: boolean },
): string | null {
  if (!wht) return null;

  if (totalAmount <= 0) {
    return "ใบที่ไม่มียอดรับชำระ ไม่สามารถบันทึกภาษีหัก ณ ที่จ่ายได้";
  }
  if (wht.taxAmount > totalAmount + AMOUNT_EPSILON) {
    return "ยอดภาษีหัก ณ ที่จ่ายมากกว่ายอดเอกสาร";
  }
  if (wht.baseAmount > totalAmount + AMOUNT_EPSILON) {
    return "ฐานภาษีมากกว่ายอดเอกสาร";
  }
  if (!options.hasCustomer) {
    return "ใบที่มีภาษีหัก ณ ที่จ่ายต้องระบุลูกค้า เพื่อใช้อ้างอิงหนังสือรับรอง 50 ทวิ";
  }
  return null;
}

/** ยอดเงินที่รับจริงหลังถูกหักภาษี — ใช้เป็นยอดที่ช่องทางรับเงินต้องรวมกันได้เท่านี้ */
export function resolveCashAmount(totalAmount: number, whtAmount: number): number {
  return roundAmount(totalAmount - whtAmount);
}

export interface WhtIssuedInput {
  incomeTypeId: string;
  baseAmount: number;
  rate: number;
  taxAmount: number;
  payCondition: "WITHHELD" | "PAID_ALWAYS" | "PAID_ONCE";
}

/**
 * ฝั่งจ่าย — เราเป็นผู้หักภาษีและออกหนังสือรับรอง 50 ทวิ เอง
 * ต่างจากฝั่งรับตรงที่ไม่มีเลขที่หนังสือรับรองให้กรอก (ระบบออกให้จากเลขเอกสารต้นทาง)
 * แต่ต้องระบุ "เงื่อนไขการหักภาษี" ตามที่แบบ ภ.ง.ด. และไฟล์นำส่งกรมสรรพากรบังคับ
 */
export const whtIssuedInputSchema = z.object({
  incomeTypeId: z.string().min(1, "กรุณาเลือกประเภทเงินได้"),
  baseAmount: z.coerce.number().gt(0, "ฐานภาษีต้องมากกว่า 0"),
  rate: z.coerce.number().min(0, "อัตราภาษีต้องไม่ติดลบ").max(100, "อัตราภาษีต้องไม่เกิน 100"),
  taxAmount: z.coerce.number().gt(0, "ยอดภาษีหัก ณ ที่จ่ายต้องมากกว่า 0"),
  payCondition: z.enum(["WITHHELD", "PAID_ALWAYS", "PAID_ONCE"]).default("WITHHELD"),
});

/** อ่านค่าภาษีที่เราหักไว้จาก FormData — คืน null เมื่อเอกสารนั้นไม่มีการหักภาษี */
export function parseWhtIssuedField(
  raw: FormDataEntryValue | null,
): { success: true; data: WhtIssuedInput | null } | { success: false; error: string } {
  if (typeof raw !== "string" || raw.trim() === "" || raw === "null") {
    return { success: true, data: null };
  }

  try {
    const parsed = whtIssuedInputSchema.parse(JSON.parse(raw));
    return { success: true, data: { ...parsed, taxAmount: roundAmount(parsed.taxAmount) } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "ข้อมูลภาษีหัก ณ ที่จ่ายไม่ถูกต้อง" };
    }
    return { success: false, error: "ข้อมูลภาษีหัก ณ ที่จ่ายไม่ถูกต้อง" };
  }
}

/** ตรวจยอดภาษีที่เราหักไว้เทียบกับยอดเอกสาร คืนข้อความภาษาไทยเมื่อไม่ผ่าน */
export function validateWhtIssuedAgainstTotal(
  wht: WhtIssuedInput | null,
  netAmount: number,
): string | null {
  if (!wht) return null;
  if (netAmount <= 0) return "เอกสารที่ไม่มียอดจ่าย ไม่สามารถหักภาษี ณ ที่จ่ายได้";
  if (wht.taxAmount > netAmount + AMOUNT_EPSILON) return "ยอดภาษีหัก ณ ที่จ่ายมากกว่ายอดเอกสาร";
  if (wht.baseAmount > netAmount + AMOUNT_EPSILON) return "ฐานภาษีมากกว่ายอดเอกสาร";
  return null;
}
