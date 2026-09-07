import { DocStatus, Prisma, WhtFormType, WhtPayCondition } from "@/lib/generated/prisma";
import { getThailandDateKey } from "@/lib/th-date";
import { roundAmount, toThaiTaxMonth, toThaiTaxYear } from "@/lib/wht";

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ที่ "เราออกให้ผู้รับเงิน"
 *
 * เลขที่หนังสือรับรองใช้เลขที่เอกสารต้นทาง (ใบค่าใช้จ่าย / ใบจ่ายชำระหนี้) ตามที่เจ้าของเลือกไว้
 * ประกาศอธิบดีกรมสรรพากร ฉบับที่ 62 บังคับเพียงให้มี "หมายเลขลำดับ" ที่ไม่ซ้ำ ไม่ได้บังคับรูปแบบ
 * และไม่ต้องมีหมายเลขเล่มเมื่อไม่ได้จัดทำเป็นเล่ม
 */

type TxClient = Prisma.TransactionClient;

export type WhtCertificateSourceType = "EXPENSE" | "SUPPLIER_PAYMENT";

export interface WhtCertificateLineInput {
  incomeTypeId: string;
  baseAmount: number;
  rate: number;
  taxAmount: number;
  payCondition: WhtPayCondition;
}

export interface PersistWhtCertificateArgs {
  sourceType: WhtCertificateSourceType;
  sourceId: string;
  /** เลขที่เอกสารต้นทาง — ใช้เป็นเลขที่หนังสือรับรอง */
  sourceNo: string;
  supplierId: string;
  payDate: Date;
  lines: WhtCertificateLineInput[];
  note: string | null;
  userId: string;
}

const FALLBACK_PREFIX = "WHT";
const MAX_REISSUE_SUFFIX = 99;

/** เลขที่สำรองเมื่อออกใบโดยไม่มีเอกสารต้นทาง — รูปแบบเดียวกับเลขเอกสารอื่นทั้ง repo */
export async function generateFallbackCertificateNo(
  tx: TxClient,
  date: Date,
): Promise<string> {
  const [year, month] = getThailandDateKey(date).split("-");
  const pattern = `${FALLBACK_PREFIX}${year.slice(-2)}${month}`;
  const last = await tx.whtCertificate.findFirst({
    where: { certNo: { startsWith: pattern } },
    orderBy: { certNo: "desc" },
    select: { certNo: true },
  });
  const sequence = last ? parseInt(last.certNo.slice(pattern.length), 10) + 1 : 1;
  return `${pattern}${String(sequence).padStart(4, "0")}`;
}

/**
 * เลขที่หนังสือรับรอง = เลขที่เอกสารต้นทาง
 * ถ้าเลขนั้นถูกใช้ไปแล้ว (เช่นออกใบเดิมแล้วยกเลิก แล้วออกใหม่จากเอกสารเดียวกัน)
 * ต่อท้ายด้วย -2, -3, ... เพื่อไม่ให้เลขซ้ำและยังตามกลับไปเอกสารต้นทางได้
 */
export async function resolveCertificateNo(
  tx: TxClient,
  sourceNo: string | null,
  date: Date,
): Promise<string> {
  if (!sourceNo) return generateFallbackCertificateNo(tx, date);

  const taken = await tx.whtCertificate.findUnique({
    where: { certNo: sourceNo },
    select: { id: true },
  });
  if (!taken) return sourceNo;

  for (let suffix = 2; suffix <= MAX_REISSUE_SUFFIX; suffix += 1) {
    const candidate = `${sourceNo}-${suffix}`;
    const exists = await tx.whtCertificate.findUnique({
      where: { certNo: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }

  throw new Error(`ออกหนังสือรับรองจากเอกสาร ${sourceNo} ซ้ำเกิน ${MAX_REISSUE_SUFFIX} ครั้ง`);
}

/** ผู้รับเงินที่เป็นบุคคลธรรมดายื่นด้วย ภ.ง.ด.3 ส่วนนิติบุคคลยื่นด้วย ภ.ง.ด.53 */
export function resolveFormType(payeeType: "INDIVIDUAL" | "JURISTIC"): WhtFormType {
  return payeeType === "INDIVIDUAL" ? WhtFormType.PND3 : WhtFormType.PND53;
}

async function loadPayeeSnapshot(tx: TxClient, supplierId: string) {
  const supplier = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { name: true, whtPayeeProfile: true },
  });
  if (!supplier) throw new Error("ไม่พบผู้รับเงิน");

  const profile = supplier.whtPayeeProfile;
  if (!profile || !profile.isActive) {
    throw new Error(
      `ยังไม่ได้บันทึกข้อมูลภาษีของ "${supplier.name}" — กรอกที่เมนูข้อมูลภาษีผู้ถูกหักก่อนออกหนังสือรับรอง`,
    );
  }

  return {
    payeeName: supplier.name,
    payeeType: profile.payeeType,
    payeeTaxId13: profile.taxId13,
    payeeTaxId10: profile.taxId10,
    payeeTitleName: profile.titleName,
    payeeFirstName: profile.firstName,
    payeeLastName: profile.lastName,
    payeeBranchNo: profile.branchNo,
    payeeAddrNo: profile.addrNo,
    payeeAddrRoad: profile.addrRoad,
    payeeAddrSubdistrict: profile.addrSubdistrict,
    payeeAddrDistrict: profile.addrDistrict,
    payeeAddrProvince: profile.addrProvince,
    payeeAddrPostcode: profile.addrPostcode,
  };
}

const sourceLink = (sourceType: WhtCertificateSourceType, sourceId: string, active: boolean) =>
  sourceType === "EXPENSE"
    ? { expenseId: sourceId, activeExpenseId: active ? sourceId : null }
    : { supplierPaymentId: sourceId, activeSupplierPaymentId: active ? sourceId : null };

const sourceWhere = (sourceType: WhtCertificateSourceType, sourceId: string) =>
  sourceType === "EXPENSE" ? { activeExpenseId: sourceId } : { activeSupplierPaymentId: sourceId };

/**
 * เขียนหนังสือรับรองให้ตรงกับเอกสารต้นทาง
 * - มีบรรทัดภาษี → สร้างใหม่ หรืออัปเดตใบที่ยัง ACTIVE อยู่ในที่เดิม (เลขที่เดิมไม่เปลี่ยน)
 * - ไม่มีบรรทัดภาษี → ยกเลิกใบเดิม (เก็บแถวไว้เป็นร่องรอย และปล่อย guard ให้ออกใหม่ได้)
 */
export async function persistWhtCertificate(
  tx: TxClient,
  args: PersistWhtCertificateArgs,
): Promise<string | null> {
  const { sourceType, sourceId, sourceNo, supplierId, payDate, lines, note, userId } = args;

  const existing = await tx.whtCertificate.findFirst({
    where: { ...sourceWhere(sourceType, sourceId), status: DocStatus.ACTIVE },
    select: { id: true, filingId: true },
  });

  if (lines.length === 0) {
    if (existing) await cancelWhtCertificate(tx, existing.id, "เอายอดภาษีหัก ณ ที่จ่ายออกจากเอกสารต้นทาง");
    return null;
  }

  if (existing?.filingId) {
    throw new Error("หนังสือรับรองใบนี้ถูกนำไปยื่นแบบ ภ.ง.ด. แล้ว ไม่สามารถแก้ไขได้");
  }

  const payee = await loadPayeeSnapshot(tx, supplierId);
  const incomeTypes = await tx.whtIncomeType.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.incomeTypeId))] } },
    select: { id: true, label: true, isActive: true, usableForIssued: true },
  });
  const incomeTypeMap = new Map(incomeTypes.map((type) => [type.id, type]));
  for (const line of lines) {
    const incomeType = incomeTypeMap.get(line.incomeTypeId);
    if (!incomeType || !incomeType.isActive || !incomeType.usableForIssued) {
      throw new Error("ประเภทเงินได้ที่เลือกใช้ออกหนังสือรับรองไม่ได้");
    }
  }

  const totalBaseAmount = roundAmount(lines.reduce((sum, line) => sum + line.baseAmount, 0));
  const totalTaxAmount = roundAmount(lines.reduce((sum, line) => sum + line.taxAmount, 0));

  const header = {
    ...payee,
    certDate: payDate,
    payDate,
    formType: resolveFormType(payee.payeeType),
    supplierId,
    totalBaseAmount,
    totalTaxAmount,
    taxMonth: toThaiTaxMonth(payDate),
    taxYear: toThaiTaxYear(payDate),
    note,
    status: DocStatus.ACTIVE,
  };

  const lineData = lines.map((line, index) => ({
    lineNo: index + 1,
    incomeTypeId: line.incomeTypeId,
    incomeLabelSnapshot: incomeTypeMap.get(line.incomeTypeId)!.label,
    payDate,
    baseAmount: line.baseAmount,
    rate: line.rate,
    taxAmount: line.taxAmount,
    payCondition: line.payCondition,
  }));

  if (existing) {
    await tx.whtCertificateLine.deleteMany({ where: { certificateId: existing.id } });
    await tx.whtCertificate.update({
      where: { id: existing.id },
      data: { ...header, lines: { create: lineData } },
    });
    return existing.id;
  }

  const certNo = await resolveCertificateNo(tx, sourceNo, payDate);
  const created = await tx.whtCertificate.create({
    data: {
      ...header,
      ...sourceLink(sourceType, sourceId, true),
      certNo,
      userId,
      lines: { create: lineData },
    },
    select: { id: true },
  });
  return created.id;
}

export interface CreateStandaloneCertificateArgs {
  supplierId: string;
  payDate: Date;
  lines: WhtCertificateLineInput[];
  note: string | null;
  userId: string;
}

/**
 * ออกหนังสือรับรองแบบเดี่ยว ไม่ผูกเอกสารต้นทาง
 * ใช้กับการจ่ายเงินที่ไม่ได้คีย์เป็นใบค่าใช้จ่าย เช่น จ่ายสดหน้างาน
 * เลขที่ใช้รูปแบบสำรอง WHT{YYMM}{4 หลัก} เพราะไม่มีเลขเอกสารต้นทางให้อ้างอิง
 */
export async function createStandaloneWhtCertificate(
  tx: TxClient,
  args: CreateStandaloneCertificateArgs,
): Promise<{ id: string; certNo: string }> {
  const { supplierId, payDate, lines, note, userId } = args;
  if (lines.length === 0) throw new Error("ต้องมีรายการเงินได้อย่างน้อย 1 รายการ");

  const payee = await loadPayeeSnapshot(tx, supplierId);
  const incomeTypes = await tx.whtIncomeType.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.incomeTypeId))] } },
    select: { id: true, label: true, isActive: true, usableForIssued: true },
  });
  const incomeTypeMap = new Map(incomeTypes.map((type) => [type.id, type]));
  for (const line of lines) {
    const incomeType = incomeTypeMap.get(line.incomeTypeId);
    if (!incomeType || !incomeType.isActive || !incomeType.usableForIssued) {
      throw new Error("ประเภทเงินได้ที่เลือกใช้ออกหนังสือรับรองไม่ได้");
    }
  }

  const certNo = await generateFallbackCertificateNo(tx, payDate);
  const created = await tx.whtCertificate.create({
    data: {
      ...payee,
      certNo,
      certDate: payDate,
      payDate,
      formType: resolveFormType(payee.payeeType),
      supplierId,
      totalBaseAmount: roundAmount(lines.reduce((sum, line) => sum + line.baseAmount, 0)),
      totalTaxAmount: roundAmount(lines.reduce((sum, line) => sum + line.taxAmount, 0)),
      taxMonth: toThaiTaxMonth(payDate),
      taxYear: toThaiTaxYear(payDate),
      note,
      userId,
      lines: {
        create: lines.map((line, index) => ({
          lineNo: index + 1,
          incomeTypeId: line.incomeTypeId,
          incomeLabelSnapshot: incomeTypeMap.get(line.incomeTypeId)!.label,
          payDate,
          baseAmount: line.baseAmount,
          rate: line.rate,
          taxAmount: line.taxAmount,
          payCondition: line.payCondition,
        })),
      },
    },
    select: { id: true, certNo: true },
  });

  return created;
}

/**
 * ยกเลิกหนังสือรับรอง — เก็บแถวไว้เป็นร่องรอยตรวจสอบ แต่ปล่อย guard ระดับ DB
 * เพื่อให้ออกใบใหม่จากเอกสารต้นทางเดิมได้ (เลขที่ใหม่จะต่อท้าย -2)
 */
export async function cancelWhtCertificate(
  tx: TxClient,
  certificateId: string,
  cancelNote: string | null,
): Promise<void> {
  const certificate = await tx.whtCertificate.findUnique({
    where: { id: certificateId },
    select: { status: true, filingId: true },
  });
  if (!certificate) throw new Error("ไม่พบหนังสือรับรอง");
  if (certificate.status === DocStatus.CANCELLED) return;
  if (certificate.filingId) {
    throw new Error("หนังสือรับรองใบนี้ถูกนำไปยื่นแบบ ภ.ง.ด. แล้ว ต้องยกเลิกรอบยื่นก่อน");
  }

  await tx.whtCertificate.update({
    where: { id: certificateId },
    data: {
      status: DocStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelNote,
      activeExpenseId: null,
      activeSupplierPaymentId: null,
    },
  });
}

/** ยกเลิกหนังสือรับรองที่ผูกกับเอกสารต้นทางที่ถูกยกเลิก */
export async function cancelWhtCertificateForSource(
  tx: TxClient,
  sourceType: WhtCertificateSourceType,
  sourceId: string,
  cancelNote: string | null,
): Promise<void> {
  const existing = await tx.whtCertificate.findFirst({
    where: { ...sourceWhere(sourceType, sourceId), status: DocStatus.ACTIVE },
    select: { id: true },
  });
  if (existing) await cancelWhtCertificate(tx, existing.id, cancelNote);
}
