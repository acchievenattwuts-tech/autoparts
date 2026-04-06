"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateBFNo } from "@/lib/doc-number";
import { writePurchaseLots, writeStockMovementLots, reversePurchaseLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";

const lotSubRowSchema = z.object({
  lotNo:    z.string().min(1).max(100),
  qty:      z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate:  z.string().default(""),
  expDate:  z.string().default(""),
});

const bfSchema = z.object({
  productId:        z.string().min(1).max(50),
  unitName:         z.string().min(1).max(20),
  qty:              z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  costPerBaseUnit:  z.coerce.number().min(0, "ราคาต้นทุนต้องไม่ติดลบ"),
  docDate:          z.string().min(1),
  note:             z.string().max(500).optional(),
  lotItems:         z.array(lotSubRowSchema).default([]),
});

export async function createBF(
  formData: FormData
): Promise<{ success?: boolean; docNo?: string; error?: string }> {
  const session = await requirePermission("stock.bf.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let lotItems: z.infer<typeof lotSubRowSchema>[] = [];
  try {
    const raw = formData.get("lotItems");
    if (typeof raw === "string" && raw) lotItems = JSON.parse(raw);
  } catch { /* ignore */ }

  const parsed = bfSchema.safeParse({
    productId:       formData.get("productId"),
    unitName:        formData.get("unitName"),
    qty:             formData.get("qty"),
    costPerBaseUnit: formData.get("costPerBaseUnit"),
    docDate:         formData.get("docDate"),
    note:            formData.get("note") || undefined,
    lotItems,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { productId, unitName, qty, costPerBaseUnit, docDate, note, lotItems: validLots } = parsed.data;

  const unit = await db.productUnit.findUnique({
    where: { productId_name: { productId, name: unitName } },
  });
  if (!unit) return { error: "ไม่พบหน่วยนับที่เลือก" };

  const scale     = Number(unit.scale);
  const qtyInBase = qty * scale;
  const docNo     = await generateBFNo(new Date(docDate));

  // Validate lot rows if product uses lot control
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { isLotControl: true, requireExpiryDate: true },
  });
  if (product?.isLotControl) {
    if (validLots.length === 0) return { error: "สินค้านี้ต้องระบุ Lot" };
    const lotErr = validateLotRows(validLots as LotSubRow[], qty, product.requireExpiryDate);
    if (lotErr) return { error: lotErr };
  }

  try {
    await dbTx(async (tx) => {
      // Create BalanceForward header
      const bf = await tx.balanceForward.create({
        data: {
          docNo,
          docDate:         new Date(docDate),
          productId,
          unitName,
          qtyInBase,
          costPerBaseUnit,
          note,
          userId: session.user!.id!,
        },
      });

      await writeStockCard(tx, {
        productId,
        docNo,
        docDate:    new Date(docDate),
        source:     "BF",
        qtyIn:      qtyInBase,
        qtyOut:     0,
        priceIn:    costPerBaseUnit,
        detail:     note ?? `ยอดยกมา ${qty} ${unitName}`,
        referenceId: bf.id,
      });

      // Lot Control
      if (product?.isLotControl && validLots.length > 0) {
        const lotsInBase = validLots.map((lot) => ({
          lotNo:        lot.lotNo.trim(),
          qtyInBase:    lot.qty * scale,
          unitCostBase: lot.unitCost / scale,
          mfgDate:      lot.mfgDate ? new Date(lot.mfgDate) : null,
          expDate:      lot.expDate ? new Date(lot.expDate) : null,
        }));

        // Use bf.id as purchaseItemId for lot tracking
        await writePurchaseLots(tx, bf.id, productId, lotsInBase);

        const sc = await tx.stockCard.findFirst({
          where: { referenceId: bf.id, source: "BF" },
          select: { id: true },
        });
        if (sc) await writeStockMovementLots(tx, sc.id, lotsInBase, "in");
      }
    });
    revalidatePath("/admin/stock/bf");
    return { success: true, docNo };
  } catch (err) {
    console.error("[createBF]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelBFSchema = z.object({
  bfId:       z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelBF(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("stock.bf.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelBFSchema.safeParse({
    bfId:       formData.get("bfId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { bfId, cancelNote } = parsed.data;

  const bf = await db.balanceForward.findUnique({ where: { id: bfId } });
  if (!bf)                        return { error: "ไม่พบเอกสาร" };
  if (bf.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  try {
    await dbTx(async (tx) => {
      // Reverse Lot balances (bf.id is used as purchaseItemId in writePurchaseLots)
      await reversePurchaseLotBalance(tx, bf.id, bf.productId);

      // Delete StockCard rows for this docNo
      await tx.stockCard.deleteMany({ where: { docNo: bf.docNo, source: "BF" } });

      // Re-calculate MAVG for this product
      await recalculateStockCard(tx, bf.productId);

      // Mark BalanceForward as CANCELLED
      await tx.balanceForward.update({
        where: { id: bfId },
        data: {
          status:      "CANCELLED",
          cancelledAt: new Date(),
          cancelNote,
        },
      });
    });
    revalidatePath("/admin/stock/bf");
    return { success: true };
  } catch (err) {
    console.error("[cancelBF]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
