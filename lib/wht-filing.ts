import {
  DocStatus,
  Prisma,
  WhtFilingStatus,
  WhtFilingSubmissionType,
  WhtFormType,
} from "@/lib/generated/prisma";
import { generateWhtFilingNo } from "@/lib/doc-number";
import { getUniqueViolationFields } from "@/lib/doc-number-retry";
import { roundAmount } from "@/lib/wht";

/**
 * รอบยื่นแบบ ภ.ง.ด. — 1 รอบ = 1 แบบ ต่อ 1 เดือนภาษี (ยื่นปกติ หรือยื่นเพิ่มเติมครั้งที่ N)
 *
 * หนังสือรับรอง 50 ทวิ ที่ยังไม่ถูกผูกกับรอบใดจะถูกดึงเข้ารอบตามเดือน/ปีภาษีและประเภทแบบ
 * เมื่อผูกแล้วใบนั้นจะแก้ไม่ได้ (guard อยู่ใน lib/wht-certificate.ts) เพื่อไม่ให้ยอดที่ยื่นไปแล้วเปลี่ยน
 */

type TxClient = Prisma.TransactionClient;

/** ข้อความเดิมของ action เมื่อแบบ / เดือนภาษี / ครั้งที่ ซ้ำกับรอบยื่นที่ยังไม่ยกเลิก */
export const WHT_FILING_PERIOD_TAKEN_MESSAGE = "มีรอบยื่นของแบบ เดือนภาษี และครั้งที่นี้อยู่แล้ว";

/** รอบที่บันทึกว่ายื่นแบบแล้วต้องยกเลิกไม่ได้ เพราะใบ 50 ทวิ จะกลับมาแก้ได้และยอดจะไม่ตรงกับที่ยื่นไป */
export const buildFiledWhtFilingCancelMessage = (filingNo: string): string =>
  `รอบยื่น ${filingNo} บันทึกว่ายื่นแบบแล้ว ยกเลิกไม่ได้`;

export class WhtFilingFiledCancelError extends Error {
  constructor(filingNo: string) {
    super(buildFiledWhtFilingCancelMessage(filingNo));
    this.name = "WhtFilingFiledCancelError";
  }
}

/**
 * P2002 จาก index "WhtFiling_active_period_key" (หรือ unique index เดิมก่อน Phase C) — ยังจับข้อความ
 * "Unique constraint" แบบเดิมไว้ด้วย เพื่อให้ผลเหมือนเดิมทุกกรณีที่ action เคยแปลงเป็นข้อความนี้
 */
export function isWhtFilingPeriodConflict(error: unknown): boolean {
  if (getUniqueViolationFields(error) !== null) return true;
  return error instanceof Error && error.message.includes("Unique constraint");
}

export interface CreateFilingArgs {
  formType: WhtFormType;
  taxMonth: number;
  taxYear: number;
  submissionType: WhtFilingSubmissionType;
  additionalSeq: number;
  surchargeAmount: number;
  note: string | null;
  userId: string;
}

/** เลขรอบยื่น WF{YYMM}{4 หลัก} ตามเดือนภาษีของรอบ (ไม่ใช่วันที่สร้าง) — ออกเลขผ่าน lib/doc-number.ts */
export async function generateFilingNo(tx: TxClient, taxYear: number, taxMonth: number): Promise<string> {
  return generateWhtFilingNo(tx, taxYear, taxMonth);
}

/** หนังสือรับรองที่เข้าเงื่อนไขของรอบยื่นและยังไม่ถูกผูกกับรอบใด */
export function unfiledCertificateWhere(
  formType: WhtFormType,
  taxMonth: number,
  taxYear: number,
): Prisma.WhtCertificateWhereInput {
  return {
    status: DocStatus.ACTIVE,
    filingId: null,
    formType,
    taxMonth,
    taxYear,
  };
}

/**
 * สร้างรอบยื่นและดึงหนังสือรับรองที่ยังไม่ยื่นของเดือนนั้นเข้ารอบทั้งหมด
 * ยอดรวมคำนวณจากใบที่ดึงเข้ามาจริง ไม่ให้ผู้ใช้พิมพ์เอง เพื่อไม่ให้ยอดในแบบเพี้ยนจากใบรับรอง
 */
export async function createWhtFiling(
  tx: TxClient,
  args: CreateFilingArgs,
): Promise<{ id: string; filingNo: string; certificateCount: number }> {
  const { formType, taxMonth, taxYear, submissionType, additionalSeq, surchargeAmount, note, userId } =
    args;

  const certificates = await tx.whtCertificate.findMany({
    where: unfiledCertificateWhere(formType, taxMonth, taxYear),
    select: { id: true, totalBaseAmount: true, totalTaxAmount: true },
  });

  if (certificates.length === 0) {
    throw new Error("ไม่มีหนังสือรับรองที่ยังไม่ได้ยื่นสำหรับแบบและเดือนภาษีที่เลือก");
  }

  const totalBaseAmount = roundAmount(
    certificates.reduce((sum, certificate) => sum + Number(certificate.totalBaseAmount), 0),
  );
  const totalTaxAmount = roundAmount(
    certificates.reduce((sum, certificate) => sum + Number(certificate.totalTaxAmount), 0),
  );
  const surcharge = roundAmount(surchargeAmount);

  const filingNo = await generateFilingNo(tx, taxYear, taxMonth);
  const filing = await tx.whtFiling.create({
    data: {
      filingNo,
      formType,
      taxMonth,
      taxYear,
      submissionType,
      additionalSeq,
      totalRecords: certificates.length,
      totalBaseAmount,
      totalTaxAmount,
      surchargeAmount: surcharge,
      grandTotalAmount: roundAmount(totalTaxAmount + surcharge),
      note,
      userId,
    },
    select: { id: true, filingNo: true },
  });

  await tx.whtCertificate.updateMany({
    where: { id: { in: certificates.map((certificate) => certificate.id) } },
    data: { filingId: filing.id },
  });

  return { ...filing, certificateCount: certificates.length };
}

/**
 * ยกเลิกรอบยื่น — ปล่อยหนังสือรับรองกลับไปเป็น "ยังไม่ยื่น" เพื่อจัดรอบใหม่ได้
 * รอบที่บันทึกว่ายื่นแบบแล้ว (FILED) ยกเลิกไม่ได้ — ตรวจที่ server ก่อนแตะข้อมูลใด ๆ
 */
export async function cancelWhtFiling(
  tx: TxClient,
  filingId: string,
  note: string | null,
): Promise<void> {
  const filing = await tx.whtFiling.findUnique({
    where: { id: filingId },
    select: { status: true, filingNo: true },
  });
  if (!filing) throw new Error("ไม่พบรอบยื่นแบบ");
  if (filing.status === WhtFilingStatus.CANCELLED) return;
  if (filing.status === WhtFilingStatus.FILED) throw new WhtFilingFiledCancelError(filing.filingNo);

  await tx.whtCertificate.updateMany({ where: { filingId }, data: { filingId: null } });
  await tx.whtFiling.update({
    where: { id: filingId },
    data: { status: WhtFilingStatus.CANCELLED, note },
  });
}

/** บันทึกว่ายื่นแบบแล้ว — ล็อกรอบไม่ให้แก้ยอดย้อนหลัง */
export async function markWhtFilingFiled(
  tx: TxClient,
  filingId: string,
  args: { filedAt: Date; filedChannel: Prisma.WhtFilingUpdateInput["filedChannel"]; rdRefNo: string | null },
): Promise<void> {
  const filing = await tx.whtFiling.findUnique({
    where: { id: filingId },
    select: { status: true },
  });
  if (!filing) throw new Error("ไม่พบรอบยื่นแบบ");
  if (filing.status === WhtFilingStatus.CANCELLED) {
    throw new Error("รอบยื่นนี้ถูกยกเลิกแล้ว");
  }

  await tx.whtFiling.update({
    where: { id: filingId },
    data: {
      status: WhtFilingStatus.FILED,
      filedAt: args.filedAt,
      filedChannel: args.filedChannel,
      rdRefNo: args.rdRefNo,
    },
  });
}
