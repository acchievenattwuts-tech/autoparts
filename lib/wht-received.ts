import { DocStatus, Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { toThaiTaxHalf, toThaiTaxYear, type WhtReceivedInput } from "@/lib/wht";

/**
 * บันทึก/แก้ไข/ยกเลิก รายการภาษีที่ "เราถูกหัก" ให้ผูกกับเอกสารต้นทาง 1:1
 * ใช้ร่วมกันระหว่างโมดูลใบเสร็จรับเงินและโมดูลบันทึกการขาย (ขายสดที่ถูกหักหน้างาน)
 */

type TxClient = Prisma.TransactionClient;

export type WhtReceivedDocType = "RECEIPT" | "SALE";

interface PersistWhtReceivedArgs {
  docType: WhtReceivedDocType;
  docId: string;
  wht: WhtReceivedInput | null;
  customerId: string | null;
  customerNameFallback: string | null;
  payDate: Date;
  userId: string;
}

const docWhere = (docType: WhtReceivedDocType, docId: string) =>
  docType === "RECEIPT" ? { receiptId: docId } : { saleId: docId };

async function resolveIncomeType(tx: TxClient, incomeTypeId: string) {
  const incomeType = await tx.whtIncomeType.findUnique({
    where: { id: incomeTypeId },
    select: { id: true, label: true, isActive: true, usableForReceived: true },
  });

  if (!incomeType || !incomeType.isActive || !incomeType.usableForReceived) {
    throw new Error("ประเภทเงินได้ที่เลือกใช้กับภาษีที่ถูกหักไม่ได้");
  }

  return incomeType;
}

async function resolveCustomerSnapshot(
  tx: TxClient,
  customerId: string | null,
  fallbackName: string | null,
): Promise<{ name: string; taxId: string | null }> {
  if (customerId) {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { name: true, taxId: true },
    });
    if (customer) return { name: customer.name, taxId: customer.taxId };
  }

  return { name: fallbackName ?? "-", taxId: null };
}

/**
 * เขียนรายการภาษีถูกหักให้ตรงกับสิ่งที่ฟอร์มส่งมา
 * - มียอดหัก → สร้างใหม่ หรืออัปเดตรายการเดิมในที่เดิม (ไฟล์แนบ 50 ทวิ ไม่หาย)
 * - ไม่มียอดหัก → ลบรายการเดิมทิ้ง แต่บล็อกไว้ถ้ามีไฟล์แนบอยู่ เพราะเป็นหลักฐานทางภาษี
 */
export async function persistWhtReceived(
  tx: TxClient,
  args: PersistWhtReceivedArgs,
): Promise<void> {
  const { docType, docId, wht, customerId, customerNameFallback, payDate, userId } = args;

  const existing = await tx.whtReceived.findFirst({
    where: docWhere(docType, docId),
    select: { id: true, _count: { select: { attachments: true } } },
  });

  if (!wht) {
    if (!existing) return;
    if (existing._count.attachments > 0) {
      throw new Error(
        "เอกสารนี้มีไฟล์แนบหนังสือรับรอง 50 ทวิ อยู่ กรุณาลบไฟล์แนบก่อนจึงจะเอายอดภาษีหัก ณ ที่จ่ายออกได้",
      );
    }
    await tx.whtReceived.delete({ where: { id: existing.id } });
    return;
  }

  const incomeType = await resolveIncomeType(tx, wht.incomeTypeId);
  const customer = await resolveCustomerSnapshot(tx, customerId, customerNameFallback);
  const certDate = wht.certDate ? parseDateOnlyToDate(wht.certDate) : null;

  const common = {
    customerId,
    customerNameSnapshot: customer.name,
    customerTaxIdSnapshot: customer.taxId,
    incomeTypeId: incomeType.id,
    incomeLabelSnapshot: incomeType.label,
    baseAmount: wht.baseAmount,
    rate: wht.rate,
    taxAmount: wht.taxAmount,
    payDate,
    taxYear: toThaiTaxYear(payDate),
    taxHalf: toThaiTaxHalf(payDate),
    certNo: wht.certNo,
    certDate,
    status: DocStatus.ACTIVE,
  };

  if (existing) {
    await tx.whtReceived.update({ where: { id: existing.id }, data: common });
    return;
  }

  await tx.whtReceived.create({
    data: {
      ...common,
      ...docWhere(docType, docId),
      certReceivedAt: wht.certNo ? new Date() : null,
      userId,
    },
  });
}

/** ยกเลิกรายการภาษีถูกหักตามเอกสารต้นทางที่ถูกยกเลิก (เก็บแถวไว้เพื่อร่องรอยตรวจสอบ) */
export async function cancelWhtReceivedForDocument(
  tx: TxClient,
  docType: WhtReceivedDocType,
  docId: string,
): Promise<void> {
  await tx.whtReceived.updateMany({
    where: { ...docWhere(docType, docId), status: DocStatus.ACTIVE },
    data: { status: DocStatus.CANCELLED },
  });
}

/** ข้อมูลภาษีถูกหักสำหรับ audit snapshot และหน้าพิมพ์ */
export const whtReceivedSnapshotSelect = {
  id: true,
  incomeLabelSnapshot: true,
  baseAmount: true,
  rate: true,
  taxAmount: true,
  certNo: true,
  certDate: true,
  certReceivedAt: true,
  taxYear: true,
  taxHalf: true,
  status: true,
} satisfies Prisma.WhtReceivedSelect;
