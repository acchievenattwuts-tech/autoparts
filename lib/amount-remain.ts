import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * คำนวณ amountRemain ของ Sale แล้วอัปเดต
 *
 * สูตร (CREDIT_SALE):
 *   amountRemain = netAmount - sum(receiptItems.paidAmount ที่ receipt.status=ACTIVE)
 *
 * หมายเหตุ: CN CREDIT_DEBT ไม่นับรวมที่นี่อีกต่อไป
 *           CN มี amountRemain ของตัวเองที่คำนวณแยก (recalculateCNAmountRemain)
 *
 * CASH_SALE → amountRemain = 0 เสมอ (จ่ายสดแล้ว ไม่มี AR)
 * CANCELLED → amountRemain = 0 เสมอ
 *
 * เรียกภายใน dbTx() เมื่อ:
 *   - สร้าง/แก้/ยกเลิก Receipt (สำหรับ item ที่มี saleId)
 *   - แก้/ยกเลิก Sale
 */
export async function recalculateSaleAmountRemain(
  tx: TxClient,
  saleId: string
): Promise<void> {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      netAmount:   true,
      status:      true,
      paymentType: true,
      receipts: {
        where: { receipt: { status: "ACTIVE" } },
        select: { paidAmount: true },
      },
    },
  });

  if (!sale) return;

  // CANCELLED → 0
  if (sale.status === "CANCELLED") {
    await tx.sale.update({
      where: { id: saleId },
      data: { amountRemain: new Prisma.Decimal(0) },
    });
    return;
  }

  // CASH_SALE → ไม่มี AR เสมอ
  if (sale.paymentType === "CASH_SALE") {
    await tx.sale.update({
      where: { id: saleId },
      data: { amountRemain: new Prisma.Decimal(0) },
    });
    return;
  }

  // CREDIT_SALE: หักเฉพาะ receipt items
  const paidByReceipts = sale.receipts.reduce(
    (sum, ri) => sum + Number(ri.paidAmount),
    0
  );
  const remain = Math.max(0, Number(sale.netAmount) - paidByReceipts);

  await tx.sale.update({
    where: { id: saleId },
    data: { amountRemain: new Prisma.Decimal(remain) },
  });
}

/**
 * คำนวณ amountRemain ของ CreditNote แล้วอัปเดต
 *
 * สูตร (CREDIT_DEBT):
 *   amountRemain = totalAmount - sum(receiptItems.paidAmount ที่ receipt.status=ACTIVE)
 *
 * CANCELLED → amountRemain = 0 เสมอ
 * settlementType != CREDIT_DEBT → amountRemain = 0 เสมอ (ไม่มี AR)
 *
 * เรียกภายใน dbTx() เมื่อ:
 *   - สร้าง/แก้/ยกเลิก Receipt (สำหรับ item ที่มี cnId)
 *   - แก้/ยกเลิก CreditNote
 */
export async function recalculateCNAmountRemain(
  tx: TxClient,
  cnId: string
): Promise<void> {
  const cn = await tx.creditNote.findUnique({
    where: { id: cnId },
    select: {
      totalAmount:    true,
      status:         true,
      settlementType: true,
      receiptItems: {
        where: { receipt: { status: "ACTIVE" } },
        select: { paidAmount: true },
      },
    },
  });

  if (!cn) return;

  // CANCELLED หรือไม่ใช่ CREDIT_DEBT → 0
  if (cn.status === "CANCELLED" || cn.settlementType !== "CREDIT_DEBT") {
    await tx.creditNote.update({
      where: { id: cnId },
      data: { amountRemain: new Prisma.Decimal(0) },
    });
    return;
  }

  const appliedByReceipts = cn.receiptItems.reduce(
    (sum, ri) => sum + Number(ri.paidAmount),
    0
  );
  const remain = Math.max(0, Number(cn.totalAmount) - appliedByReceipts);

  await tx.creditNote.update({
    where: { id: cnId },
    data: { amountRemain: new Prisma.Decimal(remain) },
  });
}
