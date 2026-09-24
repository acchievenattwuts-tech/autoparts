"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { writeStockCard, recalculateStockCardMany } from "@/lib/stock-card";
import { generateAdjNo } from "@/lib/doc-number";
import { AuditAction } from "@/lib/generated/prisma";
import { isDateOnlyString, parseDateOnlyToDate } from "@/lib/th-date";
import {
  getLotAvailability,
  writeAdjustmentLots,
  reverseAdjustmentLotBalance,
  type LotSubRow,
} from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import { LotStockInsufficientError } from "@/lib/lot-stock-error";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import {
  searchAdjustmentProductOptions,
  type AdjustmentProductOption,
} from "@/lib/adjustment-product-search";
import { getAdjustmentLineLotError } from "./adjustment-lot-guard";

const INVALID_DATE_MESSAGE = "รูปแบบวันที่ไม่ถูกต้อง";

// Lot MFG/EXP: empty (not specified) or a real YYYY-MM-DD date-only value.
const optionalDateOnlySchema = z
  .string()
  .refine((value) => value === "" || isDateOnlyString(value), INVALID_DATE_MESSAGE)
  .default("");

// Errors whose Thai message is safe and useful to show the user as-is.
class AdjustmentUserError extends Error {}

const lotSubRowSchema = z.object({
  lotNo: z.string().min(1).max(100),
  qty: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate: optionalDateOnlySchema,
  expDate: optionalDateOnlySchema,
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
  adjustDate: z.string().min(1).refine(isDateOnlyString, INVALID_DATE_MESSAGE),
  note: z.string().max(500).optional(),
  items: z.array(adjustItemSchema).min(1, "ต้องมีรายการอย่างน้อย 1 รายการ").max(50),
});

async function preloadAdjustmentMaps(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  items: z.infer<typeof adjustItemSchema>[],
): Promise<{
  unitScaleMap: Map<string, number>;
  productMap: Map<string, { inventoryTracking: string; isLotControl: boolean; requireExpiryDate: boolean; avgCost: number }>;
}> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  // Sequential awaits on the single transaction connection — Promise.all here
  // triggers the pg-adapter "client.query() while already executing" warning.
  const units = await tx.productUnit.findMany({
    where: {
      OR: items.map((item) => ({
        productId: item.productId,
        name: item.unitName,
      })),
    },
    select: { productId: true, name: true, scale: true },
  });
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, inventoryTracking: true, isLotControl: true, requireExpiryDate: true, avgCost: true },
  });

  return {
    unitScaleMap: new Map(units.map((unit) => [`${unit.productId}::${unit.name}`, Number(unit.scale)])),
    productMap: new Map(
      products.map((product) => [
        product.id,
        {
          inventoryTracking: product.inventoryTracking,
          isLotControl: product.isLotControl,
          requireExpiryDate: product.requireExpiryDate,
          avgCost: Number(product.avgCost),
        },
      ]),
    ),
  };
}

async function getAdjustmentAuditSnapshot(adjustmentId: string) {
  const adjustment = await db.adjustment.findUnique({
    where: { id: adjustmentId },
    include: {
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: {
          id: true,
          qtyAdjust: true,
          reason: true,
          product: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  if (!adjustment) {
    return null;
  }

  const stockCards = await db.stockCard.findMany({
    where: { referenceId: adjustment.id },
    orderBy: [{ docDate: "asc" }, { sorder: "asc" }, { id: "asc" }],
    include: {
      lotMovements: {
        orderBy: { id: "asc" },
        select: {
          lotNo: true,
          qtyIn: true,
          qtyOut: true,
          unitCost: true,
        },
      },
    },
  });

  return {
    id: adjustment.id,
    adjustNo: adjustment.adjustNo,
    adjustDate: adjustment.adjustDate,
    status: adjustment.status,
    note: adjustment.note,
    cancelNote: adjustment.cancelNote,
    cancelledAt: adjustment.cancelledAt,
    updatedAt: adjustment.updatedAt,
    user: adjustment.user?.name ?? adjustment.user?.email ?? null,
    items: adjustment.items.map((item) => ({
      id: item.id,
      productCode: item.product.code,
      productName: item.product.name,
      qtyAdjust: item.qtyAdjust,
      reason: item.reason,
    })),
    stockCards: stockCards.map((card) => ({
      id: card.id,
      source: card.source,
      qtyIn: card.qtyIn,
      qtyOut: card.qtyOut,
      priceIn: card.priceIn,
      priceOut: card.priceOut,
      detail: card.detail,
      lots: card.lotMovements.map((lot) => ({
        lotNo: lot.lotNo,
        qtyIn: lot.qtyIn,
        qtyOut: lot.qtyOut,
        unitCost: lot.unitCost,
      })),
    })),
  };
}

export async function createAdjustment(
  formData: FormData,
): Promise<{ success?: boolean; adjustNo?: string; error?: string }> {
  const session = await requirePermission("stock.adjustments.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  let createdAdjustmentId = "";
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
  const docDate = parseDateOnlyToDate(adjustDate);
  let adjustNo = "";

  try {
    await dbTx(async (tx) => {
      // Allocated inside the transaction under a per-month lock so concurrent
      // saves wait for each other instead of colliding on the same number.
      adjustNo = await generateAdjNo(docDate, tx);
      const { unitScaleMap, productMap } = await preloadAdjustmentMaps(tx, validItems);
      for (const item of validItems) {
        const product = productMap.get(item.productId);
        if (product && !isInventoryTracked(product.inventoryTracking)) {
          throw new Error("สินค้าไม่คำนวณสต็อกไม่สามารถใช้เอกสารปรับสต็อกได้");
        }
        // An unknown unit used to fall back to scale 1 silently, recording
        // e.g. 5 boxes as 5 pieces. Reject it instead.
        if (!unitScaleMap.has(`${item.productId}::${item.unitName}`)) {
          throw new AdjustmentUserError("ไม่พบหน่วยนับที่เลือก");
        }
        // A lot-controlled line must name its lots — rejected here, before any write.
        const lotError = product
          ? getAdjustmentLineLotError({
              isTracked: isInventoryTracked(product.inventoryTracking),
              isLotControl: product.isLotControl,
              requireExpiryDate: product.requireExpiryDate,
              type: item.type,
              lotItems: item.lotItems as LotSubRow[],
              qty: item.qty,
            })
          : null;
        if (lotError) throw new AdjustmentUserError(lotError);
      }

      const adjustment = await tx.adjustment.create({
        data: {
          adjustNo,
          adjustDate: docDate,
          userId: session.user.id,
          note,
          items: {
            create: validItems.map((item, idx) => {
              const scale = unitScaleMap.get(`${item.productId}::${item.unitName}`) ?? 1;
              const qtyBase = item.qty * scale;
              return {
                lineNo: idx + 1,
                productId: item.productId,
                qtyAdjust: item.type === "ADJUST_IN" ? qtyBase : -qtyBase,
                reason: item.reason,
              };
            }),
          },
        },
        include: { items: { orderBy: [{ lineNo: "asc" }, { id: "asc" }] } },
      });
      createdAdjustmentId = adjustment.id;

      for (let idx = 0; idx < adjustment.items.length; idx++) {
        const adjustmentItem = adjustment.items[idx];
        const inputItem = validItems[idx];
        const qtyBase = Math.abs(Number(adjustmentItem.qtyAdjust));
        const source = Number(adjustmentItem.qtyAdjust) > 0 ? ("ADJUST_IN" as const) : ("ADJUST_OUT" as const);

        const stockCardId = await writeStockCard(tx, {
          productId: adjustmentItem.productId,
          docNo: adjustNo,
          docDate,
          source,
          qtyIn: source === "ADJUST_IN" ? qtyBase : 0,
          qtyOut: source === "ADJUST_OUT" ? qtyBase : 0,
          priceIn: inputItem.price,
          detail: adjustmentItem.reason ?? note ?? "ปรับสต๊อก",
          referenceId: adjustment.id,
        });

        // Lots were validated for every lot-controlled line before the header insert.
        const product = productMap.get(adjustmentItem.productId);
        if (product?.isLotControl) {
          const scale = unitScaleMap.get(`${adjustmentItem.productId}::${inputItem.unitName}`) ?? 1;
          const lotsInBase = inputItem.lotItems.map((lot) => ({
            lotNo: lot.lotNo.trim(),
            qtyInBase: lot.qty * scale,
            unitCostBase: lot.unitCost > 0 ? lot.unitCost / scale : inputItem.price / scale || product.avgCost,
            mfgDate: lot.mfgDate ? parseDateOnlyToDate(lot.mfgDate) : null,
            expDate: lot.expDate ? parseDateOnlyToDate(lot.expDate) : null,
          }));

          const direction = source === "ADJUST_IN" ? ("in" as const) : ("out" as const);
          await writeAdjustmentLots(tx, stockCardId, adjustmentItem.productId, lotsInBase, direction);
        }
      }
    });

    const afterSnapshot = createdAdjustmentId
      ? await getAdjustmentAuditSnapshot(createdAdjustmentId)
      : null;
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "Adjustment",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.adjustNo,
        after: afterSnapshot,
      });
    }

    revalidatePath("/admin/stock/adjustments");
    return { success: true, adjustNo };
  } catch (error) {
    console.error("[createAdjustment]", error);
    // An ADJUST_OUT lot short on stock (writeAdjustmentLots) is the user's to fix.
    if (error instanceof AdjustmentUserError || error instanceof LotStockInsufficientError) {
      return { error: error.message };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const adjustmentProductQuerySchema = z.string().max(100);

/**
 * Product picker search for the adjustment form: at most 20 active, stock-tracked
 * products with only the fields the form uses. Gated like createAdjustment
 * (the sale/purchase search actions require sales/purchases permissions).
 */
export async function searchAdjustmentProducts(query: string): Promise<AdjustmentProductOption[]> {
  const session = await requirePermission("stock.adjustments.create").catch(() => null);
  if (!session?.user?.id) return [];
  const parsed = adjustmentProductQuerySchema.safeParse(query);
  if (!parsed.success) return [];
  try {
    return await searchAdjustmentProductOptions(parsed.data);
  } catch (error) {
    console.error("[searchAdjustmentProducts]", error);
    throw new Error("ค้นหาสินค้าไม่สำเร็จ");
  }
}

export async function fetchAdjustmentProductLots(
  productId: string,
  lotIssueMethod: string,
): Promise<LotAvailableJSON[] | { error: string }> {
  const session = await requirePermission("stock.adjustments.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
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

  const requestContext = await getRequestContext();
  const parsed = cancelAdjSchema.safeParse({
    adjustmentId: formData.get("adjustmentId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { adjustmentId, cancelNote } = parsed.data;

  const adjustment = await db.adjustment.findUnique({
    where: { id: adjustmentId },
    include: { items: { orderBy: { lineNo: "asc" }, select: { productId: true } } },
  });
  if (!adjustment) return { error: "ไม่พบเอกสาร" };
  if (adjustment.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedProductIds = [...new Set(adjustment.items.map((item) => item.productId))];

  try {
    const beforeSnapshot = await getAdjustmentAuditSnapshot(adjustment.id);
    await dbTx(async (tx) => {
      // Claim the document first: the conditional update row-locks it, so a
      // concurrent cancel of the same document waits, then matches 0 rows and
      // stops here — LotBalance is never reversed twice.
      const claimed = await tx.adjustment.updateMany({
        where: { id: adjustmentId, status: { not: "CANCELLED" } },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelNote,
        },
      });
      if (claimed.count === 0) {
        throw new AdjustmentUserError("เอกสารถูกยกเลิกไปแล้ว");
      }

      await reverseAdjustmentLotBalance(tx, adjustment.id, affectedProductIds);
      await tx.stockCard.deleteMany({ where: { docNo: adjustment.adjustNo } });

      // Same MAVG engine as looping recalculateStockCard(), in fewer round-trips.
      await recalculateStockCardMany(tx, affectedProductIds);
    });

    const afterSnapshot = await getAdjustmentAuditSnapshot(adjustment.id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "Adjustment",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.adjustNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: cancelNote ?? null },
      });
    }

    revalidatePath("/admin/stock/adjustments");
    return { success: true };
  } catch (error) {
    console.error("[cancelAdjustment]", error);
    if (error instanceof AdjustmentUserError) return { error: error.message };
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
