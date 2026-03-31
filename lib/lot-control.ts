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
