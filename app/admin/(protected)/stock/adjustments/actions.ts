"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateDocNo } from "@/lib/doc-number";

const adjustItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  type:      z.enum(["ADJUST_IN", "ADJUST_OUT"]),
  reason:    z.string().max(200).optional(),
});

const adjustSchema = z.object({
  adjustDate: z.string().min(1),
  note:       z.string().max(500).optional(),
  items:      z.array(adjustItemSchema).min(1, "ต้องมีรายการอย่างน้อย 1 รายการ").max(50),
});

export async function createAdjustment(
  formData: FormData
): Promise<{ success?: boolean; adjustNo?: string; error?: string }> {
  const session = await auth();
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
  const adjustNo = await generateDocNo("ADJ", new Date(adjustDate));

  try {
    await db.$transaction(async (tx) => {
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

      // Write StockCard for each item
      for (const adjItem of adj.items) {
        const qtyBase = Math.abs(Number(adjItem.qtyAdjust));
        await writeStockCard(tx, {
          productId:   adjItem.productId,
          docNo:       adjustNo,
          docDate:     new Date(adjustDate),
          source:      Number(adjItem.qtyAdjust) > 0 ? "ADJUST_IN" : "ADJUST_OUT",
          qtyIn:       Number(adjItem.qtyAdjust) > 0 ? qtyBase : 0,
          qtyOut:      Number(adjItem.qtyAdjust) < 0 ? qtyBase : 0,
          priceIn:     0,
          detail:      adjItem.reason ?? note ?? "ปรับสต็อก",
          referenceId: adj.id,
        });
      }
    });

    revalidatePath("/admin/stock/adjustments");
    return { success: true, adjustNo };
  } catch (err) {
    console.error("[createAdjustment]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelAdjSchema = z.object({
  adjustmentId: z.string().min(1),
  cancelNote:   z.string().max(200).optional(),
});

export async function cancelAdjustment(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
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
    await db.$transaction(async (tx) => {
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
