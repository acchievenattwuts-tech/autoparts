"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateAdjNo } from "@/lib/doc-number";
import { writeAdjustmentLots, reverseAdjustmentLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";

const lotSubRowSchema = z.object({
  lotNo:    z.string().min(1).max(100),
  qty:      z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate:  z.string().default(""),
  expDate:  z.string().default(""),
});

const adjustItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  type:      z.enum(["ADJUST_IN", "ADJUST_OUT"]),
  reason:    z.string().max(200).optional(),
  lotItems:  z.array(lotSubRowSchema).default([]),
});

const adjustSchema = z.object({
  adjustDate: z.string().min(1),
  note:       z.string().max(500).optional(),
  items:      z.array(adjustItemSchema).min(1, "ต้องมีรายการอย่างน้อย 1 รายการ").max(50),
});

export async function createAdjustment(
  formData: FormData
): Promise<{ success?: boolean; adjustNo?: string; error?: string }> {
  const session = await requirePermission("stock.adjustments.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof adjustItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = adjustSchema.safeParse({
    adjustDate: formData.get("adjustDate"),
    note:       formData.get("note") || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { adjustDate, note, items: validItems } = parsed.data;
  const adjustNo = await generateAdjNo(new Date(adjustDate));

  try {
    await dbTx(async (tx) => {
      // Create Adjustment header
      const adj = await tx.adjustment.create({
        data: {
          adjustNo,
          adjustDate: new Date(adjustDate),
          userId: session.user!.id!,
          note,
          items: {
            create: await Promise.all(validItems.map(async (item) => {
              const unit = await tx.productUnit.findUnique({
                where: { productId_name: { productId: item.productId, name: item.unitName } },
              });
              const scale = unit ? Number(unit.scale) : 1;
              const qtyBase = item.qty * scale;
              return {
                productId: item.productId,
                qtyAdjust: item.type === "ADJUST_IN" ? qtyBase : -qtyBase,
                reason:    item.reason,
              };
            })),
          },
        },
        include: { items: true },
      });

      // Write StockCard + Lot for each item
      for (let idx = 0; idx < adj.items.length; idx++) {
        const adjItem = adj.items[idx];
        const inputItem = validItems[idx];
        const qtyBase = Math.abs(Number(adjItem.qtyAdjust));
        const source = Number(adjItem.qtyAdjust) > 0 ? "ADJUST_IN" as const : "ADJUST_OUT" as const;

        await writeStockCard(tx, {
          productId:   adjItem.productId,
          docNo:       adjustNo,
          docDate:     new Date(adjustDate),
          source,
          qtyIn:       source === "ADJUST_IN" ? qtyBase : 0,
          qtyOut:      source === "ADJUST_OUT" ? qtyBase : 0,
          priceIn:     0,
          detail:      adjItem.reason ?? note ?? "ปรับสต็อก",
          referenceId: adj.id,
        });

        // Lot Control
        if (inputItem.lotItems.length > 0) {
          const product = await tx.product.findUnique({
            where: { id: adjItem.productId },
            select: { isLotControl: true, requireExpiryDate: true, avgCost: true },
          });
          if (product?.isLotControl) {
            const lotErr = validateLotRows(inputItem.lotItems as LotSubRow[], inputItem.qty, source === "ADJUST_IN" && product.requireExpiryDate);
            if (lotErr) throw new Error(lotErr);

            const unit = await tx.productUnit.findUnique({
              where: { productId_name: { productId: adjItem.productId, name: inputItem.unitName } },
            });
            const scale = unit ? Number(unit.scale) : 1;

            const lotsInBase = inputItem.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: lot.unitCost > 0 ? lot.unitCost / scale : Number(product.avgCost),
              mfgDate:      lot.mfgDate ? new Date(lot.mfgDate) : null,
              expDate:      lot.expDate ? new Date(lot.expDate) : null,
            }));

            const sc = await tx.stockCard.findFirst({
              where: { docNo: adjustNo, productId: adjItem.productId, referenceId: adj.id, source },
              select: { id: true },
            });

            if (sc) {
              const direction = source === "ADJUST_IN" ? "in" as const : "out" as const;
              await writeAdjustmentLots(tx, sc.id, adjItem.productId, lotsInBase, direction);
            }
          }
        }
      }
    });

    revalidatePath("/admin/stock/adjustments");
    return { success: true, adjustNo };
  } catch (err) {
    console.error("[createAdjustment]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function fetchAdjustmentProductLots(
  productId: string,
  lotIssueMethod: string
): Promise<LotAvailableJSON[] | { error: string }> {
  if (!productId) return { error: "ไม่ระบุสินค้า" };
  try {
    const balances = await db.lotBalance.findMany({
      where: { productId, qtyOnHand: { gt: 0 } },
      select: { lotNo: true, qtyOnHand: true },
    });
    const lots: LotAvailableJSON[] = await Promise.all(
      balances.map(async (b) => {
        const master = await db.productLot.findUnique({
          where: { productId_lotNo: { productId, lotNo: b.lotNo } },
          select: { unitCost: true, expDate: true, mfgDate: true },
        });
        return {
          lotNo:     b.lotNo,
          qtyOnHand: Number(b.qtyOnHand),
          unitCost:  Number(master?.unitCost ?? 0),
          expDate:   master?.expDate ? master.expDate.toISOString().slice(0, 10) : null,
          mfgDate:   master?.mfgDate ? master.mfgDate.toISOString().slice(0, 10) : null,
        };
      })
    );
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
  cancelNote:   z.string().max(200).optional(),
});

export async function cancelAdjustment(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("stock.adjustments.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelAdjSchema.safeParse({
    adjustmentId: formData.get("adjustmentId"),
    cancelNote:   formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { adjustmentId, cancelNote } = parsed.data;

  const adj = await db.adjustment.findUnique({
    where: { id: adjustmentId },
    include: { items: { select: { productId: true } } },
  });
  if (!adj)                        return { error: "ไม่พบเอกสาร" };
  if (adj.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedProductIds = [...new Set(adj.items.map((i) => i.productId))];

  try {
    await dbTx(async (tx) => {
      // Reverse Lot balances from StockMovementLot
      await reverseAdjustmentLotBalance(tx, adj.id, affectedProductIds);

      // Delete StockCard rows for this adjustment document
      await tx.stockCard.deleteMany({ where: { docNo: adj.adjustNo } });

      // Re-calculate MAVG for each affected product
      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }

      // Mark Adjustment as CANCELLED
      await tx.adjustment.update({
        where: { id: adjustmentId },
        data: {
          status:      "CANCELLED",
          cancelledAt: new Date(),
          cancelNote,
        },
      });
    });
    revalidatePath("/admin/stock/adjustments");
    return { success: true };
  } catch (err) {
    console.error("[cancelAdjustment]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
