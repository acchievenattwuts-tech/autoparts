"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generatePurchaseNo } from "@/lib/doc-number";
import { PaymentMethod, VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { Prisma } from "@/lib/generated/prisma";
import { writePurchaseLots, writeStockMovementLots, reversePurchaseLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";

const purchaseProductOptionSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  purchaseUnitName: true,
  costPrice: true,
  isLotControl: true,
  requireExpiryDate: true,
  category: { select: { name: true } },
  brand:    { select: { name: true } },
  aliases:  { select: { alias: true } },
  units: {
    select: { name: true, scale: true, isBase: true },
    orderBy: { isBase: "desc" },
  },
} as const;

export async function searchPurchaseProducts(query: string) {
  const session = await requirePermission("purchases.create").catch(() => null);
  if (!session?.user?.id) return [];

  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 3) return [];

  const searchResult = await searchProductIds({
    query: normalizedQuery,
    isActive: true,
    take: 20,
  });
  if (searchResult.ids.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: searchResult.ids } },
    select: purchaseProductOptionSelect,
  });

  return sortProductsByIds(products, searchResult.ids).map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    purchaseUnitName: product.purchaseUnitName,
    costPrice: Number(product.costPrice),
    categoryName: product.category.name,
    brandName: product.brand?.name ?? null,
    aliases: product.aliases.map((alias) => alias.alias),
    units: product.units.map((unit) => ({ name: unit.name, scale: Number(unit.scale), isBase: unit.isBase })),
    isLotControl: product.isLotControl,
    requireExpiryDate: product.requireExpiryDate,
  }));
}

const lotSubRowSchema = z.object({
  lotNo:    z.string().min(1).max(100),
  qty:      z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate:  z.string().default(""),
  expDate:  z.string().default(""),
});

const purchaseItemSchema = z.object({
  productId:   z.string().min(1).max(50),
  unitName:    z.string().min(1).max(20),
  qty:         z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  costPrice:   z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),   // per selected unit
  landedCost:  z.coerce.number().min(0).default(0),             // per selected unit
  lotItems:    z.array(lotSubRowSchema).default([]),
});

const purchaseSchema = z.object({
  supplierId:   z.string().min(1, "กรุณาเลือกผู้จำหน่าย").max(50),
  purchaseDate: z.string().min(1),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.TRANSFER),
  discount:     z.coerce.number().min(0).default(0),
  note:         z.string().max(500).optional(),
  referenceNo:  z.string().max(100).optional(),
  vatType:      z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:      z.coerce.number().min(0).max(100).default(0),
  items:        z.array(purchaseItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

export async function createPurchase(
  formData: FormData
): Promise<{ success?: boolean; purchaseNo?: string; error?: string }> {
  const session = await requirePermission("purchases.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof purchaseItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = purchaseSchema.safeParse({
    supplierId:   formData.get("supplierId") || undefined,
    purchaseDate: formData.get("purchaseDate"),
    paymentMethod: (formData.get("paymentMethod") as PaymentMethod) || PaymentMethod.TRANSFER,
    discount:     formData.get("discount") || 0,
    note:         formData.get("note") || undefined,
    referenceNo:  formData.get("referenceNo") || undefined,
    vatType:      (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:      formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supplierId, purchaseDate, paymentMethod, discount, note, referenceNo, vatType, vatRate, items: validItems } = parsed.data;

  // Calculate totals
  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const discountedTotal = Math.max(0, totalAmount - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);

  const purchaseNo = await generatePurchaseNo(new Date(purchaseDate));

  try {
    await dbTx(async (tx) => {
      // 1. Create Purchase header
      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          supplierId:    supplierId || null,
          userId:        session.user!.id!,
          totalAmount:   totalAmount,
          discount:      discount,
          netAmount:     netAmount,
          amountRemain:  new Prisma.Decimal(netAmount),
          note,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          referenceNo:   referenceNo ?? null,
          purchaseDate:  new Date(purchaseDate),
          paymentMethod,
        },
      });

      // 2. Process each line item
      for (const item of validItems) {
        // Get unit scale
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale       = Number(unit.scale);
        const qtyInBase   = item.qty * scale;
        const costPerBase = item.costPrice / scale;  // convert to base unit cost
        const lcPerBase   = item.landedCost / scale;  // landed cost per base unit

        const itemTotal    = item.qty * item.costPrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        // Create PurchaseItem
        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId:    purchase.id,
            productId:     item.productId,
            supplierId:    supplierId || null,
            quantity:      Math.round(qtyInBase),
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
            landedCost:    item.landedCost,
          },
        });

        // 3. Write StockCard with MAVG
        await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       purchaseNo,
          docDate:     new Date(purchaseDate),
          source:      "PURCHASE",
          qtyIn:       qtyInBase,
          qtyOut:      0,
          priceIn:     costPerBase,
          landedCost:  lcPerBase * qtyInBase, // total landed cost for this line
          detail:      `ซื้อเข้า ${item.qty} ${item.unitName}`,
          referenceId: purchaseItem.id,
        });

        // 4. Lot Control — only if product has isLotControl=true
        if (item.lotItems.length > 0) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { isLotControl: true, requireExpiryDate: true },
          });
          if (product?.isLotControl) {
            // Validate lot rows (server-side)
            const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, product.requireExpiryDate);
            if (lotErr) throw new Error(lotErr);

            // Convert lot rows to base unit
            const lotsInBase = item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: lot.unitCost / scale,
              mfgDate:      lot.mfgDate ? new Date(lot.mfgDate) : null,
              expDate:      lot.expDate ? new Date(lot.expDate) : null,
            }));

            await writePurchaseLots(tx, purchaseItem.id, item.productId, lotsInBase);

            // Get the StockCard row just created (referenceId = purchaseItem.id)
            const sc = await tx.stockCard.findFirst({
              where: { referenceId: purchaseItem.id, source: "PURCHASE" },
              select: { id: true },
            });
            if (sc) await writeStockMovementLots(tx, sc.id, lotsInBase, "in");
          }
        }
      }
    });

    revalidatePath("/admin/purchases");
    revalidatePath("/admin/products");
    return { success: true, purchaseNo };
  } catch (err) {
    console.error("[createPurchase]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelPurchaseSchema = z.object({
  purchaseId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelPurchase(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchases.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelPurchaseSchema.safeParse({
    purchaseId: formData.get("purchaseId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { purchaseId, cancelNote } = parsed.data;

  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      items:          { select: { id: true, productId: true } },
      purchaseReturns: { where: { status: "ACTIVE" }, select: { returnNo: true } },
    },
  });
  if (!purchase)                        return { error: "ไม่พบเอกสาร" };
  if (purchase.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  // Reference chain check: ห้ามยกเลิกถ้ามีใบคืนซัพพลายเออร์ที่ยัง active
  if (purchase.purchaseReturns.length > 0) {
    const nos = purchase.purchaseReturns.map((r) => r.returnNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบคืนสินค้าที่อ้างอิงอยู่: ${nos} — กรุณายกเลิกใบคืนก่อน` };
  }

  const affectedProductIds = [...new Set(purchase.items.map((i) => i.productId))];

  try {
    await dbTx(async (tx) => {
      // Reverse Lot balances before deleting StockCard rows
      for (const item of purchase.items) {
        await reversePurchaseLotBalance(tx, item.id, item.productId);
      }
      await tx.stockCard.deleteMany({ where: { docNo: purchase.purchaseNo } });
      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote, amountRemain: new Prisma.Decimal(0) },
      });
    });
    revalidatePath("/admin/purchases");
    return { success: true };
  } catch (err) {
    console.error("[cancelPurchase]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updatePurchase
// ─────────────────────────────────────────

export async function updatePurchase(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchases.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  // Load existing purchase
  const existing = await db.purchase.findUnique({
    where: { id },
    include: {
      items:          { select: { id: true, productId: true } },
      purchaseReturns: { where: { status: "ACTIVE" }, select: { returnNo: true } },
    },
  });
  if (!existing)                        return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  if (existing.purchaseReturns.length > 0) {
    const nos = existing.purchaseReturns.map((r) => r.returnNo).join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีใบคืนสินค้าที่อ้างอิงอยู่: ${nos}` };
  }

  // Parse form data
  let items: z.infer<typeof purchaseItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = purchaseSchema.safeParse({
    supplierId:   formData.get("supplierId") || undefined,
    purchaseDate: formData.get("purchaseDate"),
    paymentMethod: (formData.get("paymentMethod") as PaymentMethod) || PaymentMethod.TRANSFER,
    discount:     formData.get("discount") || 0,
    note:         formData.get("note") || undefined,
    referenceNo:  formData.get("referenceNo") || undefined,
    vatType:      (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:      formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supplierId, purchaseDate, paymentMethod, discount, note, referenceNo, vatType, vatRate, items: validItems } = parsed.data;

  const totalAmount     = validItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const discountedTotal = Math.max(0, totalAmount - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);

  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];

  try {
    await dbTx(async (tx) => {
      const oldItems = await tx.purchaseItem.findMany({
        where: { purchaseId: id },
        select: { id: true, productId: true },
      });

      // 1. Reverse old stock effects
      for (const item of oldItems) {
        await reversePurchaseLotBalance(tx, item.id, item.productId);
      }
      await tx.stockCard.deleteMany({ where: { docNo: existing.purchaseNo } });
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      for (const productId of oldProductIds) {
        await recalculateStockCard(tx, productId);
      }

      // 2. Update header
      await tx.purchase.update({
        where: { id },
        data: {
          supplierId:    supplierId || null,
          purchaseDate:  new Date(purchaseDate),
          discount,
          note:          note ?? null,
          referenceNo:   referenceNo ?? null,
          vatType,
          vatRate,
          totalAmount,
          subtotalAmount,
          vatAmount,
          netAmount,
          amountRemain:  new Prisma.Decimal(netAmount),
          paymentMethod,
        },
      });

      // 3. Re-create items + stock cards
      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale       = Number(unit.scale);
        const qtyInBase   = item.qty * scale;
        const costPerBase = item.costPrice / scale;
        const lcPerBase   = item.landedCost / scale;
        const itemTotal   = item.qty * item.costPrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId:    id,
            productId:     item.productId,
            supplierId:    supplierId || null,
            quantity:      Math.round(qtyInBase),
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
            landedCost:    item.landedCost,
          },
        });

        await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       existing.purchaseNo,
          docDate:     new Date(purchaseDate),
          source:      "PURCHASE",
          qtyIn:       qtyInBase,
          qtyOut:      0,
          priceIn:     costPerBase,
          landedCost:  lcPerBase * qtyInBase,
          detail:      `ซื้อเข้า ${item.qty} ${item.unitName}`,
          referenceId: purchaseItem.id,
        });

        if (item.lotItems.length > 0) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { isLotControl: true, requireExpiryDate: true },
          });
          if (product?.isLotControl) {
            const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, product.requireExpiryDate);
            if (lotErr) throw new Error(lotErr);

            const lotsInBase = item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: lot.unitCost / scale,
              mfgDate:      lot.mfgDate ? new Date(lot.mfgDate) : null,
              expDate:      lot.expDate ? new Date(lot.expDate) : null,
            }));

            await writePurchaseLots(tx, purchaseItem.id, item.productId, lotsInBase);

            const sc = await tx.stockCard.findFirst({
              where: { referenceId: purchaseItem.id, source: "PURCHASE" },
              select: { id: true },
            });
            if (sc) await writeStockMovementLots(tx, sc.id, lotsInBase, "in");
          }
        }
      }
    });

    revalidatePath("/admin/purchases");
    revalidatePath(`/admin/purchases/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updatePurchase]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
