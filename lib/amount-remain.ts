import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * คำนวณ amountRemain ของ Sale แล้วอัปเดต
 *
 * สูตร (CREDIT_SALE):
 *   amountRemain = netAmount
 *                - sum(receiptItems.paidAmount ที่ receipt.status=ACTIVE)
 *                - sum(creditNote.totalAmount ที่ status=ACTIVE AND settlementType=CREDIT_DEBT)
 *
 * CASH_SALE → amountRemain = 0 เสมอ (จ่ายสดแล้ว ไม่มี AR)
 * CANCELLED → amountRemain = 0 เสมอ
 *
 * เรียกภายใน db.$transaction() เมื่อ:
 *   - สร้าง/แก้/ยกเลิก Receipt
 *   - สร้าง/แก้/ยกเลิก CreditNote (ทุก type ที่มี saleId)
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
      creditNotes: {
        where: { status: "ACTIVE", settlementType: "CREDIT_DEBT" },
        select: { totalAmount: true },
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

  // CREDIT_SALE: หัก receipts และ CN(CREDIT_DEBT)
  const paidByReceipts = sale.receipts.reduce(
    (sum, ri) => sum + Number(ri.paidAmount),
    0
  );
  const paidByCreditDebt = sale.creditNotes.reduce(
    (sum, cn) => sum + Number(cn.totalAmount),
    0
  );
  const remain = Math.max(
    0,
    Number(sale.netAmount) - paidByReceipts - paidByCreditDebt
  );

  await tx.sale.update({
    where: { id: saleId },
    data: { amountRemain: new Prisma.Decimal(remain) },
  });
}
