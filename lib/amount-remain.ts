import {
  Prisma,
  PurchasePaymentStatus,
  PurchaseReturnSettlementType,
  PurchaseType,
} from "@/lib/generated/prisma";
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

function resolvePurchasePaymentStatus(
  netAmount: number,
  remain: number,
): PurchasePaymentStatus {
  if (remain <= 0) return PurchasePaymentStatus.PAID;
  if (remain < netAmount) return PurchasePaymentStatus.PARTIALLY_PAID;
  return PurchasePaymentStatus.UNPAID;
}

export async function recalculatePurchaseAmountRemain(
  tx: TxClient,
  purchaseId: string,
): Promise<void> {
  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      netAmount: true,
      status: true,
      purchaseType: true,
      supplierPaymentItems: {
        where: { payment: { status: "ACTIVE" } },
        select: { paidAmount: true },
      },
    },
  });

  if (!purchase) return;

  if (purchase.status === "CANCELLED") {
    await tx.purchase.update({
      where: { id: purchaseId },
      data: { amountRemain: new Prisma.Decimal(0) },
    });
    return;
  }

  if (purchase.purchaseType === PurchaseType.CASH_PURCHASE) {
    await tx.purchase.update({
      where: { id: purchaseId },
      data: {
        amountRemain: new Prisma.Decimal(0),
        paymentStatus: PurchasePaymentStatus.PAID,
      },
    });
    return;
  }

  const paidBySupplierPayments = purchase.supplierPaymentItems.reduce(
    (sum, item) => sum + Number(item.paidAmount),
    0,
  );
  const netAmount = Number(purchase.netAmount);
  const remain = Math.max(0, netAmount - paidBySupplierPayments);

  await tx.purchase.update({
    where: { id: purchaseId },
    data: {
      amountRemain: new Prisma.Decimal(remain),
      paymentStatus: resolvePurchasePaymentStatus(netAmount, remain),
    },
  });
}

export async function recalculatePurchaseReturnAmountRemain(
  tx: TxClient,
  purchaseReturnId: string,
): Promise<void> {
  const purchaseReturn = await tx.purchaseReturn.findUnique({
    where: { id: purchaseReturnId },
    select: {
      totalAmount: true,
      status: true,
      settlementType: true,
      supplierPaymentItems: {
        where: { payment: { status: "ACTIVE" } },
        select: { paidAmount: true },
      },
    },
  });

  if (!purchaseReturn) return;

  if (
    purchaseReturn.status === "CANCELLED" ||
    purchaseReturn.settlementType !== PurchaseReturnSettlementType.SUPPLIER_CREDIT
  ) {
    await tx.purchaseReturn.update({
      where: { id: purchaseReturnId },
      data: { amountRemain: new Prisma.Decimal(0) },
    });
    return;
  }

  const appliedBySupplierPayments = purchaseReturn.supplierPaymentItems.reduce(
    (sum, item) => sum + Number(item.paidAmount),
    0,
  );
  const remain = Math.max(
    0,
    Number(purchaseReturn.totalAmount) - appliedBySupplierPayments,
  );

  await tx.purchaseReturn.update({
    where: { id: purchaseReturnId },
    data: { amountRemain: new Prisma.Decimal(remain) },
  });
}

export async function recalculateSupplierAdvanceAmountRemain(
  tx: TxClient,
  advanceId: string,
): Promise<void> {
  const advance = await tx.supplierAdvance.findUnique({
    where: { id: advanceId },
    select: {
      totalAmount: true,
      status: true,
      supplierPayments: {
        where: { payment: { status: "ACTIVE" } },
        select: { paidAmount: true },
      },
    },
  });

  if (!advance) return;

  if (advance.status === "CANCELLED") {
    await tx.supplierAdvance.update({
      where: { id: advanceId },
      data: { amountRemain: new Prisma.Decimal(0) },
    });
    return;
  }

  const appliedBySupplierPayments = advance.supplierPayments.reduce(
    (sum, item) => sum + Number(item.paidAmount),
    0,
  );
  const remain = Math.max(0, Number(advance.totalAmount) - appliedBySupplierPayments);

  await tx.supplierAdvance.update({
    where: { id: advanceId },
    data: { amountRemain: new Prisma.Decimal(remain) },
  });
}
