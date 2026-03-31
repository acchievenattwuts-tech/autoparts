import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LotSubRow {
  lotNo:      string;
  qty:        number;  // ใน selected unit (ก่อนแปลงเป็น base unit)
  unitCost:   number;  // ต้นทุน/selected unit
  mfgDate:    string;  // ISO date string หรือ ""
  expDate:    string;  // ISO date string หรือ ""
}

export interface LotSubRowBase {
  lotNo:        string;
  qtyInBase:    number;  // qty ใน base unit แล้ว
  unitCostBase: number;  // ต้นทุน/base unit
  mfgDate:      Date | null;
  expDate:      Date | null;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate lot sub-rows สำหรับ product ที่ isLotControl=true
 * - sum(lot.qty) ต้องเท่ากับ itemQty
 * - lotNo ต้องไม่ว่าง
 * - ถ้า requireExpiryDate=true → expDate บังคับ
 */
export function validateLotRows(
  lots: LotSubRow[],
  itemQty: number,
  requireExpiryDate: boolean
): string | null {
  if (lots.length === 0) return "กรุณาระบุ Lot อย่างน้อย 1 รายการ";

  for (const lot of lots) {
    if (!lot.lotNo.trim()) return "กรุณากรอกเลขที่ Lot";
    if (lot.qty <= 0) return "จำนวน Lot ต้องมากกว่า 0";
    if (requireExpiryDate && !lot.expDate) return `Lot ${lot.lotNo}: กรุณากรอกวันหมดอายุ (EXP)`;
  }

  const lotNos = lots.map((l) => l.lotNo.trim());
  if (new Set(lotNos).size !== lotNos.length) return "เลขที่ Lot ซ้ำกัน";

  const totalLotQty = lots.reduce((s, l) => s + l.qty, 0);
  const diff = Math.abs(totalLotQty - itemQty);
  if (diff > 0.0001) {
    return `จำนวน Lot รวม (${totalLotQty}) ไม่ตรงกับจำนวนในบรรทัด (${itemQty})`;
  }

  return null;
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
        // อัปเดต unitCost และ expDate ถ้ารับเพิ่มครั้งต่อไป
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
 * - ถ้า qtyOnHand ติดลบให้ set เป็น 0 (edge case)
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
