"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generatePurchaseReturnNo } from "@/lib/doc-number";
import { VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { reversePurchaseReturnLotBalance, validateLotRows, writePurchaseReturnLots, writeStockMovementLots, type LotSubRow } from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";

const lotSubRowSchema = z.object({
  lotNo:    z.string().min(1).max(100),
  qty:      z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate:  z.string().default(""),
  expDate:  z.string().default(""),
});

const returnItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  lotItems:  z.array(lotSubRowSchema).default([]),
});

const returnSchema = z.object({
  returnDate: z.string().min(1, "กรุณาระบุวันที่"),
  purchaseId: z.string().max(50).optional(),
  supplierId: z.string().min(1, "กรุณาเลือกผู้จำหน่าย").max(50),
  note:       z.string().max(500).optional(),
  vatType:    z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:    z.coerce.number().min(0).max(100).default(0),
  items:      z.array(returnItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

export async function createPurchaseReturn(
  formData: FormData
): Promise<{ success?: boolean; returnNo?: string; error?: string }> {
  const session = await requirePermission("purchase_returns.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof returnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = returnSchema.safeParse({
    returnDate: formData.get("returnDate"),
    purchaseId: formData.get("purchaseId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    note:       formData.get("note") || undefined,
    vatType:    (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:    formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { returnDate, purchaseId, supplierId, note, vatType, vatRate, items: validItems } = parsed.data;

  const docDate  = new Date(returnDate);
  const returnNo = await generatePurchaseReturnNo(docDate);

  try {
    await dbTx(async (tx) => {
      // Pre-calculate: gather unit/cost data for all items
      const lineData: {
        productId:     string;
        unitName:      string;
        qty:           number;
        qtyInBase:     number;
        costPerBase:   number;
        totalAmount:   number;
        subtotalAmount: number;
        lotItems:      z.infer<typeof lotSubRowSchema>[];
      }[] = [];

      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;

        const prod = await tx.product.findUnique({
          where: { id: item.productId },
          select: { avgCost: true },
        });
        if (!prod) throw new Error("ไม่พบสินค้า");

        const costPerBase  = Number(prod.avgCost);
        const totalAmount  = Math.round(qtyInBase) * costPerBase;
        const itemSubtotal = calcItemSubtotal(totalAmount, vatType, vatRate);

        lineData.push({
          productId: item.productId,
          unitName:  item.unitName,
          qty:       item.qty,
          qtyInBase,
          costPerBase,
          totalAmount,
          subtotalAmount: itemSubtotal,
          lotItems: item.lotItems,
        });
      }

      const rawTotal    = lineData.reduce((sum, l) => sum + l.totalAmount, 0);
      const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);

      // Create PurchaseReturn header
      const pr = await tx.purchaseReturn.create({
        data: {
          returnNo,
          purchaseId:    purchaseId || null,
          supplierId:    supplierId || null,
          userId:        session.user!.id!,
          totalAmount:   netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          note:          note ?? null,
          returnDate:    docDate,
        },
      });

      // Create items and write stock cards
      for (const line of lineData) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: { isLotControl: true },
        });
        if (product?.isLotControl) {
          const lotErr = validateLotRows(line.lotItems as LotSubRow[], line.qty, false);
          if (lotErr) throw new Error(lotErr);
        }

        const returnItem = await tx.purchaseReturnItem.create({
          data: {
            purchaseReturnId: pr.id,
            productId:        line.productId,
            qty:              Math.round(line.qtyInBase),
            costPrice:        line.costPerBase,
            amount:           line.totalAmount,
            subtotalAmount:   line.subtotalAmount,
            detail:           `คืน ${line.qty} ${line.unitName}`,
          },
        });

        await writeStockCard(tx, {
          productId:   line.productId,
          docNo:       returnNo,
          docDate,
          source:      "RETURN_OUT",
          qtyIn:       0,
          qtyOut:      line.qtyInBase,
          priceIn:     0,
          detail:      `คืน ${line.qty} ${line.unitName}`,
          referenceId: returnItem.id,
        });

        if (product?.isLotControl && line.lotItems.length > 0) {
          const lineScale = line.qty === 0 ? 1 : line.qtyInBase / line.qty;
          const lotsInBase = line.lotItems.map((lot) => ({
            lotNo:        lot.lotNo.trim(),
            qtyInBase:    lot.qty * lineScale,
            unitCostBase: line.costPerBase,
            mfgDate:      lot.mfgDate ? new Date(lot.mfgDate) : null,
            expDate:      lot.expDate ? new Date(lot.expDate) : null,
          }));

          await writePurchaseReturnLots(tx, returnItem.id, line.productId, lotsInBase);

          const sc = await tx.stockCard.findFirst({
            where: { referenceId: returnItem.id, source: "RETURN_OUT" },
            select: { id: true },
          });
          if (sc) await writeStockMovementLots(tx, sc.id, lotsInBase, "out");
        }
      }
    });

    revalidatePath("/admin/purchase-returns");
    revalidatePath("/admin/products");
    return { success: true, returnNo };
  } catch (err) {
    console.error("[createPurchaseReturn]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelReturnSchema = z.object({
  returnId:   z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelPurchaseReturn(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchase_returns.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelReturnSchema.safeParse({
    returnId:   formData.get("returnId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { returnId, cancelNote } = parsed.data;

  const ret = await db.purchaseReturn.findUnique({
    where: { id: returnId },
    include: { items: { select: { id: true, productId: true } } },
  });
  if (!ret)                        return { error: "ไม่พบเอกสาร" };
  if (ret.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedProductIds = [...new Set(ret.items.map((i) => i.productId))];

  try {
    await dbTx(async (tx) => {
      // Reverse Lot balances (คืน stock ที่เคยส่งกลับซัพพลายเออร์)
      for (const item of ret.items) {
        await reversePurchaseReturnLotBalance(tx, item.id, item.productId);
      }
      await tx.stockCard.deleteMany({ where: { docNo: ret.returnNo } });
      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }
      await tx.purchaseReturn.update({
        where: { id: returnId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
      });
    });
    revalidatePath("/admin/purchase-returns");
    return { success: true };
  } catch (err) {
    console.error("[cancelPurchaseReturn]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updatePurchaseReturn
// ─────────────────────────────────────────

export async function updatePurchaseReturn(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchase_returns.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.purchaseReturn.findUnique({
    where: { id },
    include: { items: { select: { id: true, productId: true } } },
  });
  if (!existing)                        return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  let items: z.infer<typeof returnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = returnSchema.safeParse({
    returnDate: formData.get("returnDate"),
    purchaseId: formData.get("purchaseId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    note:       formData.get("note") || undefined,
    vatType:    (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:    formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { returnDate, purchaseId, supplierId, note, vatType, vatRate, items: validItems } = parsed.data;
  const docDate    = new Date(returnDate);
  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];

  try {
    await dbTx(async (tx) => {
      // 1. Reverse old stock effects
      const oldItems = await tx.purchaseReturnItem.findMany({
        where: { purchaseReturnId: id },
        select: { id: true, productId: true },
      });
      for (const item of oldItems) {
        await reversePurchaseReturnLotBalance(tx, item.id, item.productId);
      }
      await tx.stockCard.deleteMany({ where: { docNo: existing.returnNo } });
      await tx.purchaseReturnItem.deleteMany({ where: { purchaseReturnId: id } });
      for (const productId of oldProductIds) {
        await recalculateStockCard(tx, productId);
      }

      // 2. Build new line data (uses current avgCost at time of update)
      const lineData: {
        productId:     string;
        unitName:      string;
        qty:           number;
        qtyInBase:     number;
        costPerBase:   number;
        totalAmount:   number;
        subtotalAmount: number;
        lotItems:      z.infer<typeof lotSubRowSchema>[];
      }[] = [];

      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const prod = await tx.product.findUnique({
          where: { id: item.productId },
          select: { avgCost: true },
        });
        if (!prod) throw new Error("ไม่พบสินค้า");
        const costPerBase  = Number(prod.avgCost);
        const totalAmount  = Math.round(qtyInBase) * costPerBase;
        const itemSubtotal = calcItemSubtotal(totalAmount, vatType, vatRate);
        lineData.push({ productId: item.productId, unitName: item.unitName, qty: item.qty, qtyInBase, costPerBase, totalAmount, subtotalAmount: itemSubtotal, lotItems: item.lotItems });
      }

      const rawTotal = lineData.reduce((sum, l) => sum + l.totalAmount, 0);
      const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);

      // 3. Update header
      await tx.purchaseReturn.update({
        where: { id },
        data: { purchaseId: purchaseId || null, supplierId: supplierId || null, note: note ?? null, vatType, vatRate, totalAmount: netAmount, subtotalAmount, vatAmount, returnDate: docDate },
      });

      // 4. Re-create items + stock cards
      for (const line of lineData) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: { isLotControl: true },
        });
        if (product?.isLotControl) {
          const lotErr = validateLotRows(line.lotItems as LotSubRow[], line.qty, false);
          if (lotErr) throw new Error(lotErr);
        }

        const returnItem = await tx.purchaseReturnItem.create({
          data: { purchaseReturnId: id, productId: line.productId, qty: Math.round(line.qtyInBase), costPrice: line.costPerBase, amount: line.totalAmount, subtotalAmount: line.subtotalAmount, detail: `คืน ${line.qty} ${line.unitName}` },
        });
        await writeStockCard(tx, {
          productId:   line.productId,
          docNo:       existing.returnNo,
          docDate,
          source:      "RETURN_OUT",
          qtyIn:       0,
          qtyOut:      line.qtyInBase,
          priceIn:     0,
          detail:      `คืน ${line.qty} ${line.unitName}`,
          referenceId: returnItem.id,
        });
      }
    });

    revalidatePath("/admin/purchase-returns");
    revalidatePath(`/admin/purchase-returns/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updatePurchaseReturn]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// getPurchasesForSupplier — ดึงใบซื้อของซัพพลายเออร์
// ─────────────────────────────────────────
export async function getPurchasesForSupplier(
  supplierId: string
): Promise<{ id: string; purchaseNo: string; purchaseDate: Date }[]> {
  if (!supplierId) return [];
  return db.purchase.findMany({
    where: { supplierId },
    orderBy: { purchaseDate: "desc" },
    take: 200,
    select: { id: true, purchaseNo: true, purchaseDate: true },
  });
}

// ─────────────────────────────────────────
// getPurchaseDetail — ดึง items จากใบซื้อ
// ─────────────────────────────────────────
export type PurchaseDetailResult = {
  items: { productId: string; unitName: string; qty: number; lotItems: z.infer<typeof lotSubRowSchema>[] }[];
} | null;

export async function getPurchaseDetail(purchaseId: string): Promise<PurchaseDetailResult> {
  if (!purchaseId) return null;
  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      items: {
        select: {
          productId: true,
          quantity:  true,
          product: {
            select: {
              isLotControl: true,
              purchaseUnitName: true,
              units: { select: { name: true, scale: true, isBase: true } },
            },
          },
          lotItems: { select: { lotNo: true, qty: true, unitCost: true, mfgDate: true, expDate: true } },
        },
      },
    },
  });
  if (!purchase) return null;

  const items = purchase.items.map((item) => {
    const unitName = item.product.purchaseUnitName ?? "";
    const unit     = item.product.units.find((u) => u.name === unitName);
    const scale    = unit ? Number(unit.scale) : 1;
    return {
      productId: item.productId,
      unitName,
      qty: Number(item.quantity) / scale,
      lotItems: item.product.isLotControl
        ? item.lotItems.map((lot) => ({
            lotNo: lot.lotNo,
            qty: Number(lot.qty) / scale,
            unitCost: Number(lot.unitCost) * scale,
            mfgDate: lot.mfgDate ? lot.mfgDate.toISOString().slice(0, 10) : "",
            expDate: lot.expDate ? lot.expDate.toISOString().slice(0, 10) : "",
          }))
        : [],
    };
  });

  return { items };
}

export async function fetchProductLots(
  productId: string
): Promise<LotAvailableJSON[] | { error: string }> {
  if (!productId) return { error: "ไม่ระบุสินค้า" };
  try {
    const balances = await db.lotBalance.findMany({
      where: { productId, qtyOnHand: { gt: 0 } },
      select: { lotNo: true, qtyOnHand: true },
      orderBy: { lotNo: "asc" },
    });

    const lots: LotAvailableJSON[] = await Promise.all(
      balances.map(async (balance) => {
        const master = await db.productLot.findUnique({
          where: { productId_lotNo: { productId, lotNo: balance.lotNo } },
          select: { unitCost: true, expDate: true, mfgDate: true },
        });

        return {
          lotNo: balance.lotNo,
          qtyOnHand: Number(balance.qtyOnHand),
          unitCost: Number(master?.unitCost ?? 0),
          expDate: master?.expDate ? master.expDate.toISOString().slice(0, 10) : null,
          mfgDate: master?.mfgDate ? master.mfgDate.toISOString().slice(0, 10) : null,
        };
      })
    );

    return lots;
  } catch (error) {
    console.error("[fetchProductLots purchase-returns]", error);
    return { error: "โหลด Lot ไม่สำเร็จ" };
  }
}
