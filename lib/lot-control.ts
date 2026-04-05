import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

// Re-export client-safe types and pure functions
export type { LotSubRow, LotAvailable } from "@/lib/lot-control-client";
export { validateLotRows, autoAllocateLots } from "@/lib/lot-control-client";

// Import types for internal use
import type { LotSubRow } from "@/lib/lot-control-client";

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LotSubRowBase {
  lotNo:        string;
  qtyInBase:    number;  // qty ใน base unit แล้ว
  unitCostBase: number;  // ต้นทุน/base unit
  mfgDate:      Date | null;
  expDate:      Date | null;
}

export interface ClaimLotWriteInput extends LotSubRowBase {
  direction: "in" | "out";
}

// ─── Write lot rows after purchase ───────────────────────────────────────────

/**
 * บันทึก Lot rows หลังจากสร้าง PurchaseItem แล้ว:
 * 1. Upsert ProductLot (master)
 * 2. Upsert LotBalance (+qtyInBase)
 * 3. Create PurchaseItemLot
 */
export async function writePurchaseLots(
  tx: TxClient,
  purchaseItemId: string,
  productId: string,
  lots: LotSubRowBase[]
): Promise<void> {
  for (const lot of lots) {
    // 1. Upsert ProductLot master
    await tx.productLot.upsert({
      where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
      create: {
        productId,
        lotNo:         lot.lotNo,
        purchaseItemId,
        mfgDate:       lot.mfgDate,
        expDate:       lot.expDate,
        unitCost:      new Prisma.Decimal(lot.unitCostBase),
      },
      update: {
        unitCost: new Prisma.Decimal(lot.unitCostBase),
        expDate:  lot.expDate ?? undefined,
      },
    });

    // 2. Upsert LotBalance
    await tx.lotBalance.upsert({
      where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
      create: {
        productId,
        lotNo:     lot.lotNo,
        qtyOnHand: new Prisma.Decimal(lot.qtyInBase),
      },
      update: {
        qtyOnHand: { increment: new Prisma.Decimal(lot.qtyInBase) },
      },
    });

    // 3. Create PurchaseItemLot
    await tx.purchaseItemLot.create({
      data: {
        purchaseItemId,
        lotNo:    lot.lotNo,
        qty:      new Prisma.Decimal(lot.qtyInBase),
        unitCost: new Prisma.Decimal(lot.unitCostBase),
        mfgDate:  lot.mfgDate,
        expDate:  lot.expDate,
      },
    });
  }
}

/**
 * สร้าง StockMovementLot ผูกกับ StockCard row ที่เพิ่งสร้าง
 */
export async function writeStockMovementLots(
  tx: TxClient,
  stockCardId: string,
  lots: LotSubRowBase[],
  direction: "in" | "out"
): Promise<void> {
  for (const lot of lots) {
    await tx.stockMovementLot.create({
      data: {
        stockCardId,
        lotNo:    lot.lotNo,
        qtyIn:    direction === "in"  ? new Prisma.Decimal(lot.qtyInBase) : new Prisma.Decimal(0),
        qtyOut:   direction === "out" ? new Prisma.Decimal(lot.qtyInBase) : new Prisma.Decimal(0),
        unitCost: new Prisma.Decimal(lot.unitCostBase),
      },
    });
  }
}

/**
 * Reverse lot balance เมื่อยกเลิกเอกสาร
 * - ลบ qty ออกจาก LotBalance (กรณี purchase cancel)
 */
export async function reversePurchaseLotBalance(
  tx: TxClient,
  purchaseItemId: string,
  productId: string
): Promise<void> {
  const lotItems = await tx.purchaseItemLot.findMany({
    where: { purchaseItemId },
    select: { lotNo: true, qty: true },
  });

  for (const lot of lotItems) {
    await tx.lotBalance.updateMany({
      where: { productId, lotNo: lot.lotNo },
      data: {
        qtyOnHand: { decrement: lot.qty },
      },
    });
    // Clamp to 0
    await tx.$executeRaw`
      UPDATE "LotBalance"
      SET "qtyOnHand" = GREATEST("qtyOnHand", 0)
      WHERE "productId" = ${productId} AND "lotNo" = ${lot.lotNo}
    `;
  }
}

// ─── Sale Lot functions ───────────────────────────────────────────────────────

/**
 * บันทึก SaleItemLot + deduct LotBalance หลังจากสร้าง SaleItem
 */
export async function writeSaleLots(
  tx: TxClient,
  saleItemId: string,
  productId: string,
  lots: LotSubRowBase[]
): Promise<void> {
  for (const lot of lots) {
    // Deduct LotBalance
    await tx.lotBalance.updateMany({
      where: { productId, lotNo: lot.lotNo },
      data: { qtyOnHand: { decrement: new Prisma.Decimal(lot.qtyInBase) } },
    });
    // Clamp to 0
    await tx.$executeRaw`
      UPDATE "LotBalance"
      SET "qtyOnHand" = GREATEST("qtyOnHand", 0)
      WHERE "productId" = ${productId} AND "lotNo" = ${lot.lotNo}
    `;

    // Create SaleItemLot
    await tx.saleItemLot.create({
      data: {
        saleItemId,
        lotNo:    lot.lotNo,
        qty:      new Prisma.Decimal(lot.qtyInBase),
        unitCost: new Prisma.Decimal(lot.unitCostBase),
      },
    });
  }
}

// ─── PurchaseReturn Lot functions ────────────────────────────────────────────

/**
 * บันทึก PurchaseReturnItemLot + ลด LotBalance เมื่อสร้างใบคืนซัพพลายเออร์
 */
export async function writePurchaseReturnLots(
  tx: TxClient,
  returnItemId: string,
  productId: string,
  lots: LotSubRowBase[]
): Promise<void> {
  for (const lot of lots) {
    // Deduct LotBalance (stock goes out to supplier)
    await tx.lotBalance.updateMany({
      where: { productId, lotNo: lot.lotNo },
      data: { qtyOnHand: { decrement: new Prisma.Decimal(lot.qtyInBase) } },
    });
    await tx.$executeRaw`
      UPDATE "LotBalance"
      SET "qtyOnHand" = GREATEST("qtyOnHand", 0)
      WHERE "productId" = ${productId} AND "lotNo" = ${lot.lotNo}
    `;
    // Create PurchaseReturnItemLot
    await tx.purchaseReturnItemLot.create({
      data: {
        purchaseReturnItemId: returnItemId,
        lotNo: lot.lotNo,
        qty:   new Prisma.Decimal(lot.qtyInBase),
      },
    });
  }
}

/**
 * Reverse PurchaseReturnItemLot — คืน qty กลับ LotBalance เมื่อยกเลิกใบคืนซัพพลายเออร์
 * (stock ที่เคยส่งคืนซัพพลายเออร์ถูกยกเลิก → เพิ่มกลับเข้า LotBalance)
 */
export async function reversePurchaseReturnLotBalance(
  tx: TxClient,
  returnItemId: string,
  productId: string
): Promise<void> {
  const lotItems = await tx.purchaseReturnItemLot.findMany({
    where: { purchaseReturnItemId: returnItemId },
    select: { lotNo: true, qty: true },
  });
  for (const lot of lotItems) {
    await tx.lotBalance.upsert({
      where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
      create: { productId, lotNo: lot.lotNo, qtyOnHand: lot.qty },
      update: { qtyOnHand: { increment: lot.qty } },
    });
  }
}

// ─── CreditNote Lot functions ─────────────────────────────────────────────────

/**
 * บันทึก CreditNoteItemLot + เพิ่ม LotBalance เมื่อสร้าง CN ประเภท RETURN
 * - isReturnLot=false → merge กลับ lot เดิม
 * - isReturnLot=true  → สร้าง lot ใหม่ prefix "RET-{lotNo}"
 */
export async function writeCreditNoteLots(
  tx: TxClient,
  cnItemId: string,
  productId: string,
  lots: (LotSubRowBase & { isReturnLot: boolean })[]
): Promise<void> {
  for (const lot of lots) {
    const effectiveLotNo = lot.isReturnLot ? `RET-${lot.lotNo}` : lot.lotNo;

    if (lot.isReturnLot) {
      // สร้าง ProductLot ใหม่สำหรับ RET-lot ถ้ายังไม่มี
      await tx.productLot.upsert({
        where: { productId_lotNo: { productId, lotNo: effectiveLotNo } },
        create: {
          productId,
          lotNo:    effectiveLotNo,
          expDate:  lot.expDate,
          unitCost: new Prisma.Decimal(lot.unitCostBase),
        },
        update: {},
      });
    }

    // Increment LotBalance (stock comes back in)
    await tx.lotBalance.upsert({
      where: { productId_lotNo: { productId, lotNo: effectiveLotNo } },
      create: { productId, lotNo: effectiveLotNo, qtyOnHand: new Prisma.Decimal(lot.qtyInBase) },
      update: { qtyOnHand: { increment: new Prisma.Decimal(lot.qtyInBase) } },
    });

    // Create CreditNoteItemLot
    await tx.creditNoteItemLot.create({
      data: {
        creditNoteItemId: cnItemId,
        lotNo:        effectiveLotNo,
        qty:          new Prisma.Decimal(lot.qtyInBase),
        isReturnLot:  lot.isReturnLot,
      },
    });
  }
}

/**
 * Reverse CreditNoteItemLot — ยกเลิก CN RETURN
 * - isReturnLot=false (merge) → ลด LotBalance กลับ
 * - isReturnLot=true  (RET-)  → ลบ LotBalance + ProductLot ของ RET-lot ทิ้ง
 */
export async function reverseCreditNoteLotBalance(
  tx: TxClient,
  cnItemId: string,
  productId: string
): Promise<void> {
  const lotItems = await tx.creditNoteItemLot.findMany({
    where: { creditNoteItemId: cnItemId },
    select: { lotNo: true, qty: true, isReturnLot: true },
  });
  for (const lot of lotItems) {
    if (lot.isReturnLot) {
      // ลบ LotBalance + ProductLot ของ RET-lot
      await tx.lotBalance.deleteMany({ where: { productId, lotNo: lot.lotNo } });
      await tx.productLot.deleteMany({ where: { productId, lotNo: lot.lotNo } });
    } else {
      // Merge lot → ลด LotBalance กลับ
      await tx.lotBalance.updateMany({
        where: { productId, lotNo: lot.lotNo },
        data: { qtyOnHand: { decrement: lot.qty } },
      });
      await tx.$executeRaw`
        UPDATE "LotBalance"
        SET "qtyOnHand" = GREATEST("qtyOnHand", 0)
        WHERE "productId" = ${productId} AND "lotNo" = ${lot.lotNo}
      `;
    }
  }
}

/**
 * Reverse SaleItemLot — คืน qty กลับ LotBalance เมื่อยกเลิกใบขาย
 */
export async function reverseSaleLotBalance(
  tx: TxClient,
  saleItemId: string,
  productId: string
): Promise<void> {
  const lotItems = await tx.saleItemLot.findMany({
    where: { saleItemId },
    select: { lotNo: true, qty: true },
  });

  for (const lot of lotItems) {
    await tx.lotBalance.upsert({
      where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
      create: { productId, lotNo: lot.lotNo, qtyOnHand: lot.qty },
      update: { qtyOnHand: { increment: lot.qty } },
    });
  }
}

// ─── Warranty Claim Lot functions ─────────────────────────────────────────────

/**
 * บันทึก WarrantyClaimLot + ปรับ LotBalance
 * - direction="in"  -> เพิ่ม LotBalance
 * - direction="out" -> ลด LotBalance
 * - ถ้าเป็น direction="in" จะ upsert ProductLot เพื่อเก็บ snapshot lot ที่รับกลับ
 */
export async function writeClaimLot(
  tx: TxClient,
  claimId: string,
  productId: string,
  lot: ClaimLotWriteInput
): Promise<void> {
  if (lot.direction === "in") {
    await tx.productLot.upsert({
      where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
      create: {
        productId,
        lotNo: lot.lotNo,
        mfgDate: lot.mfgDate,
        expDate: lot.expDate,
        unitCost: new Prisma.Decimal(lot.unitCostBase),
      },
      update: {
        mfgDate: lot.mfgDate ?? undefined,
        expDate: lot.expDate ?? undefined,
        unitCost: new Prisma.Decimal(lot.unitCostBase),
      },
    });

    await tx.lotBalance.upsert({
      where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
      create: {
        productId,
        lotNo: lot.lotNo,
        qtyOnHand: new Prisma.Decimal(lot.qtyInBase),
      },
      update: {
        qtyOnHand: { increment: new Prisma.Decimal(lot.qtyInBase) },
      },
    });
  } else {
    await tx.lotBalance.updateMany({
      where: { productId, lotNo: lot.lotNo },
      data: { qtyOnHand: { decrement: new Prisma.Decimal(lot.qtyInBase) } },
    });
    await tx.$executeRaw`
      UPDATE "LotBalance"
      SET "qtyOnHand" = GREATEST("qtyOnHand", 0)
      WHERE "productId" = ${productId} AND "lotNo" = ${lot.lotNo}
    `;
  }

  await tx.warrantyClaimLot.create({
    data: {
      claimId,
      lotNo: lot.lotNo,
      qty: new Prisma.Decimal(lot.qtyInBase),
      direction: lot.direction,
      unitCost: new Prisma.Decimal(lot.unitCostBase),
    },
  });
}

/**
 * Reverse LotBalance จาก StockMovementLot ของใบเคลม
 * ใช้กับ reopen/cancel เพื่อย้อนเฉพาะชุด movement ที่ต้องการได้
 */
export async function reverseClaimLotBalance(
  tx: TxClient,
  claimId: string,
  productId: string,
  options?: { docNos?: string[] }
): Promise<void> {
  const stockCards = await tx.stockCard.findMany({
    where: options?.docNos?.length
      ? { docNo: { in: options.docNos } }
      : { referenceId: claimId },
    select: {
      id: true,
      lotMovements: {
        select: { lotNo: true, qtyIn: true, qtyOut: true },
      },
    },
  });

  for (const stockCard of stockCards) {
    for (const lot of stockCard.lotMovements) {
      if (Number(lot.qtyIn) > 0) {
        await tx.lotBalance.updateMany({
          where: { productId, lotNo: lot.lotNo },
          data: { qtyOnHand: { decrement: lot.qtyIn } },
        });
        await tx.$executeRaw`
          UPDATE "LotBalance"
          SET "qtyOnHand" = GREATEST("qtyOnHand", 0)
          WHERE "productId" = ${productId} AND "lotNo" = ${lot.lotNo}
        `;
      }

      if (Number(lot.qtyOut) > 0) {
        await tx.lotBalance.upsert({
          where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
          create: {
            productId,
            lotNo: lot.lotNo,
            qtyOnHand: lot.qtyOut,
          },
          update: {
            qtyOnHand: { increment: lot.qtyOut },
          },
        });
      }
    }
  }
}
