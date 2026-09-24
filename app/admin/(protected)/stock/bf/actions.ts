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
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateBFNo } from "@/lib/doc-number";
import { AuditAction } from "@/lib/generated/prisma";
import { writeBalanceForwardLots, writeStockMovementLots, reverseBalanceForwardLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";
import { isDateOnlyString, parseDateOnlyToDate } from "@/lib/th-date";
import { isInventoryTracked } from "@/lib/inventory-tracking";

const INVALID_DATE_MESSAGE = "รูปแบบวันที่ไม่ถูกต้อง";

// Lot MFG/EXP: empty (not specified) or a real YYYY-MM-DD date-only value.
const optionalDateOnlySchema = z
  .string()
  .refine((value) => value === "" || isDateOnlyString(value), INVALID_DATE_MESSAGE)
  .default("");

// Errors whose Thai message is safe and useful to show the user as-is.
class BalanceForwardUserError extends Error {}

const lotSubRowSchema = z.object({
  lotNo:    z.string().min(1).max(100),
  qty:      z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate:  optionalDateOnlySchema,
  expDate:  optionalDateOnlySchema,
});

const bfSchema = z.object({
  productId:        z.string().min(1).max(50),
  unitName:         z.string().min(1).max(20),
  qty:              z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  costPerBaseUnit:  z.coerce.number().min(0, "ราคาต้นทุนต้องไม่ติดลบ"),
  docDate:          z.string().min(1).refine(isDateOnlyString, INVALID_DATE_MESSAGE),
  note:             z.string().max(500).optional(),
  lotItems:         z.array(lotSubRowSchema).default([]),
});

async function getBalanceForwardAuditSnapshot(bfId: string) {
  const balanceForward = await db.balanceForward.findUnique({
    where: { id: bfId },
    include: {
      product: {
        select: {
          code: true,
          name: true,
          isLotControl: true,
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

  if (!balanceForward) {
    return null;
  }

  const stockCards = await db.stockCard.findMany({
    where: { referenceId: balanceForward.id, source: "BF" },
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
    id: balanceForward.id,
    docNo: balanceForward.docNo,
    docDate: balanceForward.docDate,
    status: balanceForward.status,
    unitName: balanceForward.unitName,
    qtyInBase: balanceForward.qtyInBase,
    costPerBaseUnit: balanceForward.costPerBaseUnit,
    note: balanceForward.note,
    cancelNote: balanceForward.cancelNote,
    cancelledAt: balanceForward.cancelledAt,
    product: {
      code: balanceForward.product.code,
      name: balanceForward.product.name,
      isLotControl: balanceForward.product.isLotControl,
    },
    user: balanceForward.user?.name ?? balanceForward.user?.email ?? null,
    stockCards: stockCards.map((card) => ({
      id: card.id,
      qtyIn: card.qtyIn,
      qtyOut: card.qtyOut,
      priceIn: card.priceIn,
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

export async function createBF(
  formData: FormData
): Promise<{ success?: boolean; docNo?: string; error?: string }> {
  const session = await requirePermission("stock.bf.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  let createdBalanceForwardId = "";
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
  const parsedDocDate = parseDateOnlyToDate(docDate);
  let docNo = "";

  // Validate lot rows if product uses lot control
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { inventoryTracking: true, isLotControl: true, requireExpiryDate: true },
  });
  if (product && !isInventoryTracked(product.inventoryTracking)) {
    return { error: "สินค้าไม่คำนวณสต็อกไม่สามารถบันทึกยอดยกมาได้" };
  }
  if (product?.isLotControl) {
    if (validLots.length === 0) return { error: "สินค้านี้ต้องระบุ Lot" };
    const lotErr = validateLotRows(validLots as LotSubRow[], qty, product.requireExpiryDate);
    if (lotErr) return { error: lotErr };
  }

  try {
    await dbTx(async (tx) => {
      // Allocated inside the transaction under a per-month lock so concurrent
      // saves wait for each other instead of colliding on the same number.
      docNo = await generateBFNo(parsedDocDate, tx);

      // Create BalanceForward header
      const bf = await tx.balanceForward.create({
        data: {
          docNo,
          docDate:         parsedDocDate,
          productId,
          unitName,
          qtyInBase,
          costPerBaseUnit,
          note,
          userId: session.user!.id!,
        },
      });
      createdBalanceForwardId = bf.id;

      const stockCardId = await writeStockCard(tx, {
        productId,
        docNo,
        docDate:    parsedDocDate,
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
          mfgDate:      lot.mfgDate ? parseDateOnlyToDate(lot.mfgDate) : null,
          expDate:      lot.expDate ? parseDateOnlyToDate(lot.expDate) : null,
        }));

        // ProductLot + LotBalance only — a BF is not a PurchaseItem, so no
        // PurchaseItemLot (its purchaseItemId FK would reject bf.id). The lot
        // trail lives on the BF StockCard row, which cancelBF reverses from.
        await writeBalanceForwardLots(tx, productId, lotsInBase);
        await writeStockMovementLots(tx, stockCardId, lotsInBase, "in");
      }
    });
    const afterSnapshot = createdBalanceForwardId
      ? await getBalanceForwardAuditSnapshot(createdBalanceForwardId)
      : null;
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "BalanceForward",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.docNo,
        after: afterSnapshot,
      });
    }
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

  const requestContext = await getRequestContext();
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
    const beforeSnapshot = await getBalanceForwardAuditSnapshot(bf.id);
    await dbTx(async (tx) => {
      // Mark BalanceForward as CANCELLED first, conditionally: the update
      // row-locks the document, so a concurrent cancel of the same BF waits,
      // then matches 0 rows and stops — Lot balances are never reversed twice.
      const claimed = await tx.balanceForward.updateMany({
        where: { id: bfId, status: { not: "CANCELLED" } },
        data: {
          status:      "CANCELLED",
          cancelledAt: new Date(),
          cancelNote,
        },
      });
      if (claimed.count === 0) {
        throw new BalanceForwardUserError("เอกสารถูกยกเลิกไปแล้ว");
      }

      // Reverse Lot balances from the BF StockCard's StockMovementLot rows —
      // must run before the StockCard delete below (StockMovementLot cascades).
      await reverseBalanceForwardLotBalance(tx, bf.id, bf.productId);

      // Delete StockCard rows for this docNo
      await tx.stockCard.deleteMany({ where: { docNo: bf.docNo, source: "BF" } });

      // Re-calculate MAVG for this product
      await recalculateStockCard(tx, bf.productId);
    });
    const afterSnapshot = await getBalanceForwardAuditSnapshot(bf.id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "BalanceForward",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.docNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: cancelNote ?? null },
      });
    }
    revalidatePath("/admin/stock/bf");
    return { success: true };
  } catch (err) {
    console.error("[cancelBF]", err);
    if (err instanceof BalanceForwardUserError) return { error: err.message };
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
