"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateAdjNo } from "@/lib/doc-number";
import {
  getLotAvailability,
  writeAdjustmentLots,
  reverseAdjustmentLotBalance,
  validateLotRows,
  type LotSubRow,
} from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";

const lotSubRowSchema = z.object({
  lotNo: z.string().min(1).max(100),
  qty: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate: z.string().default(""),
  expDate: z.string().default(""),
});

const adjustItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName: z.string().min(1).max(20),
  qty: z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  price: z.coerce.number().min(0, "ราคาต้องไม่น้อยกว่า 0"),
  type: z.enum(["ADJUST_IN", "ADJUST_OUT"]),
  reason: z.string().max(200).optional(),
  lotItems: z.array(lotSubRowSchema).default([]),
});

const adjustSchema = z.object({
  adjustDate: z.string().min(1),
  note: z.string().max(500).optional(),
  items: z.array(adjustItemSchema).min(1, "ต้องมีรายการอย่างน้อย 1 รายการ").max(50),
});

async function preloadAdjustmentMaps(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  items: z.infer<typeof adjustItemSchema>[],
): Promise<{
  unitScaleMap: Map<string, number>;
  productMap: Map<string, { isLotControl: boolean; requireExpiryDate: boolean; avgCost: number }>;
}> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const [units, products] = await Promise.all([
    tx.productUnit.findMany({
      where: {
        OR: items.map((item) => ({
          productId: item.productId,
          name: item.unitName,
        })),
      },
      select: { productId: true, name: true, scale: true },
    }),
    tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, isLotControl: true, requireExpiryDate: true, avgCost: true },
    }),
  ]);

  return {
    unitScaleMap: new Map(units.map((unit) => [`${unit.productId}::${unit.name}`, Number(unit.scale)])),
    productMap: new Map(
      products.map((product) => [
        product.id,
        {
          isLotControl: product.isLotControl,
          requireExpiryDate: product.requireExpiryDate,
          avgCost: Number(product.avgCost),
        },
      ]),
    ),
  };
}

export async function createAdjustment(
  formData: FormData,
): Promise<{ success?: boolean; adjustNo?: string; error?: string }> {
  const session = await requirePermission("stock.adjustments.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof adjustItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = adjustSchema.safeParse({
    adjustDate: formData.get("adjustDate"),
    note: formData.get("note") || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { adjustDate, note, items: validItems } = parsed.data;
  const adjustNo = await generateAdjNo(new Date(adjustDate));

  try {
    await dbTx(async (tx) => {
      const { unitScaleMap, productMap } = await preloadAdjustmentMaps(tx, validItems);

      const adjustment = await tx.adjustment.create({
        data: {
          adjustNo,
          adjustDate: new Date(adjustDate),
          userId: session.user.id,
          note,
          items: {
            create: validItems.map((item) => {
              const scale = unitScaleMap.get(`${item.productId}::${item.unitName}`) ?? 1;
              const qtyBase = item.qty * scale;
              return {
                productId: item.productId,
                qtyAdjust: item.type === "ADJUST_IN" ? qtyBase : -qtyBase,
                reason: item.reason,
              };
            }),
          },
        },
        include: { items: true },
      });

      for (let idx = 0; idx < adjustment.items.length; idx++) {
        const adjustmentItem = adjustment.items[idx];
        const inputItem = validItems[idx];
        const qtyBase = Math.abs(Number(adjustmentItem.qtyAdjust));
        const source = Number(adjustmentItem.qtyAdjust) > 0 ? ("ADJUST_IN" as const) : ("ADJUST_OUT" as const);

        const stockCardId = await writeStockCard(tx, {
          productId: adjustmentItem.productId,
          docNo: adjustNo,
          docDate: new Date(adjustDate),
          source,
          qtyIn: source === "ADJUST_IN" ? qtyBase : 0,
          qtyOut: source === "ADJUST_OUT" ? qtyBase : 0,
          priceIn: inputItem.price,
          detail: adjustmentItem.reason ?? note ?? "ปรับสต๊อก",
          referenceId: adjustment.id,
        });

        if (inputItem.lotItems.length > 0) {
          const product = productMap.get(adjustmentItem.productId);
          if (product?.isLotControl) {
            const lotError = validateLotRows(
              inputItem.lotItems as LotSubRow[],
              inputItem.qty,
              source === "ADJUST_IN" && product.requireExpiryDate,
            );
            if (lotError) throw new Error(lotError);

            const scale = unitScaleMap.get(`${adjustmentItem.productId}::${inputItem.unitName}`) ?? 1;
            const lotsInBase = inputItem.lotItems.map((lot) => ({
              lotNo: lot.lotNo.trim(),
              qtyInBase: lot.qty * scale,
              unitCostBase: lot.unitCost > 0 ? lot.unitCost / scale : inputItem.price / scale || product.avgCost,
              mfgDate: lot.mfgDate ? new Date(lot.mfgDate) : null,
              expDate: lot.expDate ? new Date(lot.expDate) : null,
            }));

            const direction = source === "ADJUST_IN" ? ("in" as const) : ("out" as const);
            await writeAdjustmentLots(tx, stockCardId, adjustmentItem.productId, lotsInBase, direction);
          }
        }
      }
    });

    revalidatePath("/admin/stock/adjustments");
    return { success: true, adjustNo };
  } catch (error) {
    console.error("[createAdjustment]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function fetchAdjustmentProductLots(
  productId: string,
  lotIssueMethod: string,
): Promise<LotAvailableJSON[] | { error: string }> {
  if (!productId) return { error: "ไม่ระบุสินค้า" };
  try {
    const lots: LotAvailableJSON[] = await getLotAvailability(db, productId);
    if (lotIssueMethod === "FEFO") {
      lots.sort((a, b) => {
        if (!a.expDate) return 1;
        if (!b.expDate) return -1;
        return a.expDate.localeCompare(b.expDate);
      });
    } else {
      lots.sort((a, b) => {
        if (!a.mfgDate) return 1;
        if (!b.mfgDate) return -1;
        return a.mfgDate.localeCompare(b.mfgDate);
      });
    }
    return lots;
  } catch {
    return { error: "ไม่สามารถโหลดข้อมูล Lot ได้" };
  }
}

const cancelAdjSchema = z.object({
  adjustmentId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelAdjustment(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("stock.adjustments.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelAdjSchema.safeParse({
    adjustmentId: formData.get("adjustmentId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { adjustmentId, cancelNote } = parsed.data;

  const adjustment = await db.adjustment.findUnique({
    where: { id: adjustmentId },
    include: { items: { select: { productId: true } } },
  });
  if (!adjustment) return { error: "ไม่พบเอกสาร" };
  if (adjustment.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedProductIds = [...new Set(adjustment.items.map((item) => item.productId))];

  try {
    await dbTx(async (tx) => {
      await reverseAdjustmentLotBalance(tx, adjustment.id, affectedProductIds);
      await tx.stockCard.deleteMany({ where: { docNo: adjustment.adjustNo } });

      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }

      await tx.adjustment.update({
        where: { id: adjustmentId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelNote,
        },
      });
    });

    revalidatePath("/admin/stock/adjustments");
    return { success: true };
  } catch (error) {
    console.error("[cancelAdjustment]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
