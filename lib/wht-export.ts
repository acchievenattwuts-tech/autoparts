import { roundAmount } from "@/lib/wht";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * ไฟล์นำส่งข้อมูลภาษีหัก ณ ที่จ่ายให้กรมสรรพากร
 *
 * รองรับ 2 รูปแบบที่กรมสรรพากรรับจริง:
 *  1. **Format กลาง 2.0** (ปรับปรุง 16/06/2568) — HEADER 1 แถว + DETAIL แถวละผู้ถูกหัก
 *     ใช้ฝากไฟล์ออนไลน์ผ่านโปรแกรม SWC / SWC-UI
 *  2. **ไฟล์ pipe-txt สำหรับ RD Prep** — 18 คอลัมน์ ผู้ใช้ลากจับคู่คอลัมน์เองในโปรแกรม
 *
 * ข้อกำหนดของไฟล์ Format กลาง (จากเอกสารสเปค):
 *  - UTF-8 · คั่นด้วย pipe "|" · ไม่มี pipe ปิดหัวและท้ายแถว · ขึ้นบรรทัดด้วย CR/LF
 *  - ตัวเลขทศนิยม 2 ตำแหน่งเสมอ ไม่มีข้อมูลให้ใส่ 0.00 · ข้อความว่างให้เว้นว่าง
 *  - ห้ามมีอักขระพิเศษ * + / \ ! $ % # & @ , ' " ในข้อมูล
 *  - วันที่เป็น ววดดปปปป โดยปีเป็น พ.ศ.
 */

/** DETAIL ของ Format กลางบรรจุได้ 3 รายการเงินได้ต่อผู้ถูกหัก 1 แถว */
export const MAX_INCOME_LINES_PER_DETAIL = 3;

const BANNED_CHARACTERS = /[*+/\\!$%#&@,'"|]/g;

/** ตัดอักขระที่สเปคห้าม และบีบช่องว่างซ้ำ เพื่อไม่ให้ไฟล์ถูกปฏิเสธตอนอัปโหลด */
export function sanitizeExportText(value: string | null | undefined, maxLength: number): string {
  if (!value) return "";
  return value
    .replace(BANNED_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** ตัวเลขทศนิยม 2 ตำแหน่งตามสเปค — ไม่มีข้อมูลคือ 0.00 ไม่ใช่ค่าว่าง */
export function formatExportAmount(value: number | null | undefined): string {
  return roundAmount(Number(value ?? 0)).toFixed(2);
}

/** อัตราภาษีรูปแบบ 4,2 */
export function formatExportRate(value: number | null | undefined): string {
  return roundAmount(Number(value ?? 0)).toFixed(2);
}

/** ววดดปปปป ปี พ.ศ. ตามวันที่ในเขตเวลาไทย */
export function formatExportDate(value: Date | string): string {
  const [year, month, day] = getThailandDateKey(value).split("-");
  return `${day}${month}${Number(year) + 543}`;
}

const EMPTY_DATE = "00000000";
const EMPTY_TIN10 = "0000000000";

export interface WhtExportIncomeLine {
  payDate: Date | string;
  rate: number;
  baseAmount: number;
  taxAmount: number;
  incomeLabel: string;
  /** 1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว */
  payConditionCode: "1" | "2" | "3";
}

export interface WhtExportPayee {
  taxId13: string;
  taxId10: string | null;
  branchNo: string;
  titleName: string | null;
  firstName: string;
  lastName: string | null;
  addrNo: string | null;
  moo: string | null;
  soi: string | null;
  road: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postcode: string | null;
  lines: WhtExportIncomeLine[];
}

export interface WhtExportFilingHeader {
  /** PND3 หรือ PND53 */
  taxType: "PND3" | "PND53";
  payerTaxId13: string;
  payerBranchNo: string;
  departmentName: string;
  taxMonth: number;
  /** ปีภาษี พ.ศ. */
  taxYear: number;
  /** 00 = ยื่นปกติ, 01-99 = ยื่นเพิ่มเติมครั้งที่ N */
  formTypeCode: string;
  surchargeAmount: number;
  /** รหัสเข้าระบบ e-Filing หรือเลขอ้างอิงการลงทะเบียน */
  userId: string;
  /** 1 = ยื่นสื่อฝากไฟล์, 2 = ยื่นแบบอินเทอร์เน็ต */
  formFlag: "1" | "2";
}

const PAY_CONDITION_CODES: Record<string, "1" | "2" | "3"> = {
  WITHHELD: "1",
  PAID_ALWAYS: "2",
  PAID_ONCE: "3",
};

export function toPayConditionCode(value: string): "1" | "2" | "3" {
  return PAY_CONDITION_CODES[value] ?? "1";
}

/** DETAIL 1 แถว = ผู้ถูกหัก 1 ราย + รายการเงินได้ไม่เกิน 3 รายการ */
function buildDetailRow(sequenceNo: number, payee: WhtExportPayee): string {
  const slots = Array.from({ length: MAX_INCOME_LINES_PER_DETAIL }, (_, index) => payee.lines[index] ?? null);

  const incomeFields = slots.flatMap((line) =>
    line
      ? [
          formatExportDate(line.payDate),
          formatExportRate(line.rate),
          formatExportAmount(line.baseAmount),
          formatExportAmount(line.taxAmount),
          sanitizeExportText(line.incomeLabel, 100),
          line.payConditionCode,
        ]
      : [EMPTY_DATE, "0.00", "0.00", "0.00", "", ""],
  );

  return [
    "D",
    String(sequenceNo),
    payee.branchNo || "000000",
    payee.taxId13.replace(/\D/g, ""),
    payee.taxId10?.replace(/\D/g, "") || EMPTY_TIN10,
    sanitizeExportText(payee.titleName, 10),
    sanitizeExportText(payee.firstName, 100),
    sanitizeExportText(payee.lastName, 80),
    ...incomeFields,
    "", // 27 ชื่ออาคาร
    "", // 28 ห้องเลขที่
    "", // 29 ชั้นที่
    "", // 30 หมู่บ้าน
    sanitizeExportText(payee.addrNo, 20),
    sanitizeExportText(payee.moo, 20),
    sanitizeExportText(payee.soi, 100),
    sanitizeExportText(payee.road, 100),
    sanitizeExportText(payee.subdistrict, 50),
    sanitizeExportText(payee.district, 50),
    sanitizeExportText(payee.province, 50),
    (payee.postcode ?? "").replace(/\D/g, "").slice(0, 5),
  ].join("|");
}

function buildHeaderRow(header: WhtExportFilingHeader, payees: WhtExportPayee[]): string {
  const totalBase = payees.reduce(
    (sum, payee) => sum + payee.lines.reduce((lineSum, line) => lineSum + line.baseAmount, 0),
    0,
  );
  const totalTax = payees.reduce(
    (sum, payee) => sum + payee.lines.reduce((lineSum, line) => lineSum + line.taxAmount, 0),
    0,
  );
  const surcharge = roundAmount(header.surchargeAmount);
  const payerTaxId = header.payerTaxId13.replace(/\D/g, "");
  const branchNo = header.payerBranchNo || "000000";

  return [
    "H",
    "0000", // รหัสผู้นำส่ง — กรณียื่นด้วยสื่อฯ ระบุ 0000
    payerTaxId,
    branchNo,
    "1", // นำส่งในฐานะผู้หักภาษี ณ ที่จ่าย
    header.taxType,
    payerTaxId,
    branchNo,
    sanitizeExportText(header.departmentName, 80),
    "1", // นำส่งภาษีตามมาตรา 3 เตรส
    "0", // มาตรา 48 ทวิ
    "0", // มาตรา 50 (3)(4)(5)
    "0", // ผู้ประกอบการรายใหญ่ (LTO)
    String(header.taxMonth).padStart(2, "0"),
    String(header.taxYear),
    "", // ประเภทสาขา — ไม่ได้จด VAT/SBT จึงไม่ระบุค่าใด ๆ ตามสเปค
    header.formTypeCode.padStart(2, "0"),
    String(payees.length),
    formatExportAmount(totalBase),
    formatExportAmount(totalTax),
    formatExportAmount(surcharge),
    formatExportAmount(roundAmount(totalTax) + surcharge),
    formatExportAmount(0),
    sanitizeExportText(header.userId, 20),
    header.formFlag,
  ].join("|");
}

/**
 * ชื่อไฟล์ตามสเปค:
 * TAX_TYPE_NID_BRANCH_NO_TAX_YEAR_TAX_MONTH_FORM_TYPE_ครั้งที่ส่ง.txt
 */
export function buildFormat20FileName(header: WhtExportFilingHeader, submissionSeq = 0): string {
  return [
    header.taxType,
    header.payerTaxId13.replace(/\D/g, ""),
    header.payerBranchNo || "000000",
    String(header.taxYear),
    String(header.taxMonth).padStart(2, "0"),
    header.formTypeCode.padStart(2, "0"),
    String(submissionSeq).padStart(2, "0"),
  ].join("_") + ".txt";
}

/** ไฟล์ Format กลาง 2.0 — HEADER 1 แถว ตามด้วย DETAIL แถวละผู้ถูกหัก */
export function buildFormat20File(
  header: WhtExportFilingHeader,
  payees: WhtExportPayee[],
): { fileName: string; content: string } {
  const rows = [
    buildHeaderRow(header, payees),
    ...payees.map((payee, index) => buildDetailRow(index + 1, payee)),
  ];

  return {
    fileName: buildFormat20FileName(header),
    content: `${rows.join("\r\n")}\r\n`,
  };
}

/**
 * ไฟล์สำหรับโปรแกรม RD Prep — 18 คอลัมน์ คั่นด้วย pipe วันที่รูปแบบ dd/mm/yy
 * ลำดับคอลัมน์ตามที่ RD Prep ให้จับคู่: ลำดับที่ · เลขประจำตัวผู้เสียภาษี · สาขาที่ ·
 * คำนำหน้าชื่อ · ชื่อ · ชื่อสกุล · เลขที่ · ถนน · ตำบล/แขวง · อำเภอ/เขต · จังหวัด ·
 * รหัสไปรษณีย์ · วันเดือนปีที่จ่าย · ประเภทเงินได้ · อัตราภาษี · จำนวนเงินได้ที่จ่าย ·
 * จำนวนภาษีที่หัก · เงื่อนไขการหักภาษี
 */
export function buildRdPrepFile(payees: WhtExportPayee[]): { fileName: string; content: string } {
  const rows: string[] = [];
  let sequenceNo = 0;

  for (const payee of payees) {
    for (const line of payee.lines) {
      sequenceNo += 1;
      const [year, month, day] = getThailandDateKey(line.payDate).split("-");
      rows.push(
        [
          String(sequenceNo),
          payee.taxId13.replace(/\D/g, ""),
          payee.branchNo || "000000",
          sanitizeExportText(payee.titleName, 10),
          sanitizeExportText(payee.firstName, 100),
          sanitizeExportText(payee.lastName, 80),
          sanitizeExportText(payee.addrNo, 20),
          sanitizeExportText(payee.road, 100),
          sanitizeExportText(payee.subdistrict, 50),
          sanitizeExportText(payee.district, 50),
          sanitizeExportText(payee.province, 50),
          (payee.postcode ?? "").replace(/\D/g, "").slice(0, 5),
          `${day}/${month}/${String(Number(year) + 543).slice(-2)}`,
          sanitizeExportText(line.incomeLabel, 100),
          formatExportRate(line.rate),
          formatExportAmount(line.baseAmount),
          formatExportAmount(line.taxAmount),
          line.payConditionCode,
        ].join("|"),
      );
    }
  }

  return { fileName: "rdprep.txt", content: `${rows.join("\r\n")}\r\n` };
}
