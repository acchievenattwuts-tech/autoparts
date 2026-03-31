"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateClaimNo } from "@/lib/doc-number";
import { ClaimType, WarrantyClaimStatus, ClaimOutcome } from "@/lib/generated/prisma";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createClaimSchema = z.object({
  warrantyId:      z.string().min(1).max(50),
  claimDate:       z.string().min(1),
  claimType:       z.nativeEnum(ClaimType),
  symptom:         z.string().max(500).optional(),
  note:            z.string().max(500).optional(),
  supplierId:      z.string().max(50).optional(),
  supplierName:    z.string().max(200).optional(),
  supplierPhone:   z.string().max(30).optional(),
  supplierAddress: z.string().max(500).optional(),
});

const updateClaimSchema = z.object({
  symptom:         z.string().max(500).optional(),
  note:            z.string().max(500).optional(),
  supplierId:      z.string().max(50).optional(),
  supplierName:    z.string().max(200).optional(),
  supplierPhone:   z.string().max(30).optional(),
  supplierAddress: z.string().max(500).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get current avgCost for a product — used as priceIn for neutral stock-in entries */
async function getAvgCost(productId: string): Promise<number> {
  const p = await db.product.findUnique({ where: { id: productId }, select: { avgCost: true } });
  return Number(p?.avgCost ?? 0);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function createClaim(
  formData: FormData
): Promise<{ claimNo?: string; error?: string }> {
  try {
    await requirePermission("warranty_claims.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = createClaimSchema.safeParse({
    warrantyId:      formData.get("warrantyId"),
    claimDate:       formData.get("claimDate"),
    claimType:       formData.get("claimType"),
    symptom:         formData.get("symptom") || undefined,
    note:            formData.get("note") || undefined,
    supplierId:      formData.get("supplierId") || undefined,
    supplierName:    formData.get("supplierName") || undefined,
    supplierPhone:   formData.get("supplierPhone") || undefined,
    supplierAddress: formData.get("supplierAddress") || undefined,
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const d = parsed.data;

  const warranty = await db.warranty.findUnique({
    where: { id: d.warrantyId },
    select: {
      id: true,
      productId: true,
      saleItem: { select: { supplierId: true, supplierName: true } },
    },
  });
  if (!warranty) return { error: "ไม่พบข้อมูลประกัน" };

  const claimNo   = await generateClaimNo(new Date(d.claimDate));
  const claimDate = new Date(d.claimDate);

  try {
    await dbTx(async (tx) => {
      // Fetch avgCost inside tx for MAVG-neutral stock-in entries
      const prod = await tx.product.findUnique({
        where: { id: warranty.productId },
        select: { avgCost: true },
      });
      const avgCost = Number(prod?.avgCost ?? 0);

      const claim = await tx.warrantyClaim.create({
        data: {
          claimNo,
          warrantyId:      d.warrantyId,
          claimDate,
          claimType:       d.claimType,
          status:          WarrantyClaimStatus.DRAFT,
          symptom:         d.symptom,
          note:            d.note,
          supplierId:      d.supplierId || warranty.saleItem?.supplierId || null,
          supplierName:    d.supplierName || warranty.saleItem?.supplierName || null,
          supplierPhone:   d.supplierPhone || null,
          supplierAddress: d.supplierAddress || null,
        },
      });

      // REPLACE_NOW: รับสินค้าเสียจากลูกค้ากลับ (+1 @ avgCost ไม่ให้ MAVG เพี้ยน)
      //              ส่งสินค้าใหม่ให้ลูกค้า (-1)
      if (d.claimType === ClaimType.REPLACE_NOW) {
        await writeStockCard(tx, {
          productId:   warranty.productId,
          docNo:       claimNo,
          docDate:     claimDate,
          source:      "CLAIM_RETURN_IN",
          qtyIn:       1,
          qtyOut:      0,
          priceIn:     avgCost, // ใช้ avgCost ปัจจุบัน ไม่ให้ต้นทุนเพี้ยน
          detail:      `รับคืนสินค้าเคลม ${claimNo}`,
          referenceId: claim.id,
        });
        await writeStockCard(tx, {
          productId:   warranty.productId,
          docNo:       claimNo,
          docDate:     claimDate,
          source:      "CLAIM_REPLACE_OUT",
          qtyIn:       0,
          qtyOut:      1,
          priceIn:     0,
          detail:      `ส่งสินค้าใหม่แทนเคลม ${claimNo}`,
          referenceId: claim.id,
        });
      }

      // CUSTOMER_WAIT: รับสินค้าเสียจากลูกค้า (+1 @ avgCost ไม่ให้ MAVG เพี้ยน)
      if (d.claimType === ClaimType.CUSTOMER_WAIT) {
        await writeStockCard(tx, {
          productId:   warranty.productId,
          docNo:       claimNo,
          docDate:     claimDate,
          source:      "CLAIM_RETURN_IN",
          qtyIn:       1,
          qtyOut:      0,
          priceIn:     avgCost,
          detail:      `รับคืนสินค้าเคลม ${claimNo}`,
          referenceId: claim.id,
        });
      }
    });

    revalidatePath("/admin/warranty-claims");
    return { claimNo };
  } catch {
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function updateClaim(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  try {
    await requirePermission("warranty_claims.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status === WarrantyClaimStatus.CLOSED || claim.status === WarrantyClaimStatus.CANCELLED) {
    return { error: "ไม่สามารถแก้ไขใบเคลมที่ปิดหรือยกเลิกแล้ว" };
  }

  const parsed = updateClaimSchema.safeParse({
    symptom:         formData.get("symptom") || undefined,
    note:            formData.get("note") || undefined,
    supplierId:      formData.get("supplierId") || undefined,
    supplierName:    formData.get("supplierName") || undefined,
    supplierPhone:   formData.get("supplierPhone") || undefined,
    supplierAddress: formData.get("supplierAddress") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const d = parsed.data;

  try {
    await db.warrantyClaim.update({
      where: { id },
      data: {
        symptom:         d.symptom ?? null,
        note:            d.note ?? null,
        supplierId:      d.supplierId || null,
        supplierName:    d.supplierName || null,
        supplierPhone:   d.supplierPhone || null,
        supplierAddress: d.supplierAddress || null,
      },
    });
    revalidatePath(`/admin/warranty-claims/${id}`);
    revalidatePath("/admin/warranty-claims");
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
}

export async function sendClaimToSupplier(
  id: string,
  sentAt: string
): Promise<{ error?: string }> {
  try {
    await requirePermission("warranty_claims.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: {
      claimNo: true,
      status: true,
      claimType: true,
      warranty: { select: { productId: true } },
    },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status !== WarrantyClaimStatus.DRAFT) return { error: "สถานะไม่อนุญาตให้ส่งเคลม" };

  const sentDate  = new Date(sentAt);
  const docNo     = `${claim.claimNo}-S`;

  try {
    await dbTx(async (tx) => {
      await tx.warrantyClaim.update({
        where: { id },
        data: { status: WarrantyClaimStatus.SENT_TO_SUPPLIER, sentAt: sentDate },
      });

      await writeStockCard(tx, {
        productId:   claim.warranty.productId,
        docNo,
        docDate:     sentDate,
        source:      "CLAIM_SEND_OUT",
        qtyIn:       0,
        qtyOut:      1,
        priceIn:     0,
        detail:      `ส่งสินค้าเคลมไปซัพพลายเออร์ ${claim.claimNo}`,
        referenceId: id,
      });
    });

    revalidatePath("/admin/warranty-claims");
    revalidatePath(`/admin/warranty-claims/${id}`);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
}

export async function closeClaim(
  id: string,
  outcome: string,
  resolvedAt: string,
  note?: string
): Promise<{ error?: string }> {
  try {
    await requirePermission("warranty_claims.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsedOutcome = z.nativeEnum(ClaimOutcome).safeParse(outcome);
  if (!parsedOutcome.success) return { error: "ผลลัพธ์ไม่ถูกต้อง" };

  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: {
      claimNo: true,
      status: true,
      claimType: true,
      warranty: { select: { productId: true } },
    },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status !== WarrantyClaimStatus.SENT_TO_SUPPLIER) return { error: "ต้องส่งซัพพลายเออร์ก่อนปิดเคลม" };

  const resolvedDate = new Date(resolvedAt);
  const docNo        = `${claim.claimNo}-R`;

  try {
    await dbTx(async (tx) => {
      await tx.warrantyClaim.update({
        where: { id },
        data: {
          status:     WarrantyClaimStatus.CLOSED,
          outcome:    parsedOutcome.data,
          resolvedAt: resolvedDate,
          note:       note || undefined,
        },
      });

      // ได้รับสินค้ากลับจากซัพพลายเออร์ (+1 @ avgCost ปัจจุบัน)
      if (parsedOutcome.data === ClaimOutcome.RECEIVED) {
        const prod = await tx.product.findUnique({
          where: { id: claim.warranty.productId },
          select: { avgCost: true },
        });
        const avgCost = Number(prod?.avgCost ?? 0);

        await writeStockCard(tx, {
          productId:   claim.warranty.productId,
          docNo,
          docDate:     resolvedDate,
          source:      "CLAIM_RECV_IN",
          qtyIn:       1,
          qtyOut:      0,
          priceIn:     avgCost,
          detail:      `ได้รับสินค้าคืนจากซัพพลายเออร์ ${claim.claimNo}`,
          referenceId: id,
        });
      }
    });

    revalidatePath("/admin/warranty-claims");
    revalidatePath(`/admin/warranty-claims/${id}`);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
}

export async function reopenClaim(id: string): Promise<{ error?: string }> {
  try {
    await requirePermission("warranty_claims.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: {
      claimNo: true,
      status: true,
      outcome: true,
      warranty: { select: { productId: true } },
    },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status !== WarrantyClaimStatus.CLOSED) return { error: "สามารถย้อนกลับได้เฉพาะสถานะปิดเคลม" };

  const productId = claim.warranty.productId;

  try {
    await dbTx(async (tx) => {
      // ถ้าเคยรับสินค้าคืน ให้ลบ CLAIM_RECV_IN row ออกแล้วคำนวณ stock ใหม่
      if (claim.outcome === ClaimOutcome.RECEIVED) {
        await tx.stockCard.deleteMany({ where: { docNo: `${claim.claimNo}-R` } });
        await recalculateStockCard(tx, productId);
      }

      await tx.warrantyClaim.update({
        where: { id },
        data: {
          status:     WarrantyClaimStatus.SENT_TO_SUPPLIER,
          outcome:    null,
          resolvedAt: null,
        },
      });
    });

    revalidatePath("/admin/warranty-claims");
    revalidatePath(`/admin/warranty-claims/${id}`);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
}

export async function cancelClaimAction(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const id = formData.get("claimId") as string;
  const result = await cancelClaim(id);
  return result.error ? { error: result.error } : { success: true };
}

export async function cancelClaim(id: string): Promise<{ error?: string }> {
  try {
    await requirePermission("warranty_claims.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: {
      claimNo: true,
      status: true,
      claimType: true,
      sentAt: true,
      resolvedAt: true,
      outcome: true,
      warranty: { select: { productId: true } },
    },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status === WarrantyClaimStatus.CANCELLED) return { error: "ยกเลิกไปแล้ว" };

  const productId = claim.warranty.productId;

  try {
    await dbTx(async (tx) => {
      await tx.warrantyClaim.update({
        where: { id },
        data: { status: WarrantyClaimStatus.CANCELLED },
      });

      // ลบ StockCard rows ที่เกี่ยวกับใบเคลมนี้ (referenceId = claim.id)
      await tx.stockCard.deleteMany({ where: { referenceId: id } });
      // ลบ StockCard rows ที่ใช้ claimNo เป็น docNo (REPLACE_NOW/CUSTOMER_WAIT ตอนสร้าง)
      await tx.stockCard.deleteMany({ where: { docNo: claim.claimNo } });
      // ลบ rows ที่ใช้ claimNo-S / claimNo-R (SENT/RECV steps — format ใหม่)
      await tx.stockCard.deleteMany({ where: { docNo: `${claim.claimNo}-S` } });
      await tx.stockCard.deleteMany({ where: { docNo: `${claim.claimNo}-R` } });
      // ลบ rows format เก่า: {claimId}-SENT / {claimId}-RECV (โค้ดรุ่นก่อน)
      await tx.stockCard.deleteMany({ where: { docNo: `${id}-SENT` } });
      await tx.stockCard.deleteMany({ where: { docNo: `${id}-RECV` } });

      await recalculateStockCard(tx, productId);
    });

    revalidatePath("/admin/warranty-claims");
    revalidatePath(`/admin/warranty-claims/${id}`);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
}
