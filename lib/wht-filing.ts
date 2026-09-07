import {
  DocStatus,
  Prisma,
  WhtFilingStatus,
  WhtFilingSubmissionType,
  WhtFormType,
} from "@/lib/generated/prisma";
import { getThailandDateKey } from "@/lib/th-date";
import { roundAmount } from "@/lib/wht";

/**
 * รอบยื่นแบบ ภ.ง.ด. — 1 รอบ = 1 แบบ ต่อ 1 เดือนภาษี (ยื่นปกติ หรือยื่นเพิ่มเติมครั้งที่ N)
 *
 * หนังสือรับรอง 50 ทวิ ที่ยังไม่ถูกผูกกับรอบใดจะถูกดึงเข้ารอบตามเดือน/ปีภาษีและประเภทแบบ
 * เมื่อผูกแล้วใบนั้นจะแก้ไม่ได้ (guard อยู่ใน lib/wht-certificate.ts) เพื่อไม่ให้ยอดที่ยื่นไปแล้วเปลี่ยน
 */

type TxClient = Prisma.TransactionClient;

const FILING_PREFIX = "WF";

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

export async function generateFilingNo(tx: TxClient, date = new Date()): Promise<string> {
  const [year, month] = getThailandDateKey(date).split("-");
  const pattern = `${FILING_PREFIX}${year.slice(-2)}${month}`;
  const last = await tx.whtFiling.findFirst({
    where: { filingNo: { startsWith: pattern } },
    orderBy: { filingNo: "desc" },
    select: { filingNo: true },
  });
  const sequence = last ? parseInt(last.filingNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(sequence).padStart(4, "0")}`;
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

  const filingNo = await generateFilingNo(tx);
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

/** ยกเลิกรอบยื่น — ปล่อยหนังสือรับรองกลับไปเป็น "ยังไม่ยื่น" เพื่อจัดรอบใหม่ได้ */
export async function cancelWhtFiling(
  tx: TxClient,
  filingId: string,
  note: string | null,
): Promise<void> {
  const filing = await tx.whtFiling.findUnique({
    where: { id: filingId },
    select: { status: true },
  });
  if (!filing) throw new Error("ไม่พบรอบยื่นแบบ");
  if (filing.status === WhtFilingStatus.CANCELLED) return;

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
