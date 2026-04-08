"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, dbTx } from "@/lib/db";
import { generateClaimNo } from "@/lib/doc-number";
import { ClaimOutcome, ClaimType, WarrantyClaimStatus } from "@/lib/generated/prisma";
import {
  autoAllocateLots,
  getLotAvailability,
  reverseClaimLotBalance,
  writeClaimLot,
  writeStockMovementLots,
} from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import { requirePermission } from "@/lib/require-auth";
import { recalculateStockCard, writeStockCard } from "@/lib/stock-card";

const createClaimSchema = z.object({
  warrantyId: z.string().min(1).max(50),
  claimDate: z.string().min(1),
  claimType: z.nativeEnum(ClaimType),
  replacementLotNo: z.string().max(100).optional(),
  symptom: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
  supplierId: z.string().max(50).optional(),
  supplierName: z.string().max(200).optional(),
  supplierPhone: z.string().max(30).optional(),
  supplierAddress: z.string().max(500).optional(),
});

const updateClaimSchema = z.object({
  symptom: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
  supplierId: z.string().max(50).optional(),
  supplierName: z.string().max(200).optional(),
  supplierPhone: z.string().max(30).optional(),
  supplierAddress: z.string().max(500).optional(),
});

const closeClaimReceivedLotSchema = z.object({
  receivedLotNo: z.string().max(100).optional(),
  receivedMfgDate: z.string().optional(),
  receivedExpDate: z.string().optional(),
});

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function getAvgCost(tx: TxClient, productId: string): Promise<number> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { avgCost: true },
  });
  return Number(product?.avgCost ?? 0);
}

async function getClaimReplacementLots(
  tx: TxClient,
  productId: string
): Promise<LotAvailableJSON[]> {
  return getLotAvailability(tx, productId);
}

function normalizeOptionalDate(value?: string): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00`);
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function createClaim(
  formData: FormData
): Promise<{ claimNo?: string; error?: string }> {
  try {
    await requirePermission("warranty_claims.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = createClaimSchema.safeParse({
    warrantyId: formData.get("warrantyId"),
    claimDate: formData.get("claimDate"),
    claimType: formData.get("claimType"),
    replacementLotNo: formData.get("replacementLotNo") || undefined,
    symptom: formData.get("symptom") || undefined,
    note: formData.get("note") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    supplierName: formData.get("supplierName") || undefined,
    supplierPhone: formData.get("supplierPhone") || undefined,
    supplierAddress: formData.get("supplierAddress") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const data = parsed.data;

  const warranty = await db.warranty.findUnique({
    where: { id: data.warrantyId },
    select: {
      id: true,
      endDate: true,
      lotNo: true,
      productId: true,
      product: { select: { isLotControl: true } },
      saleItem: { select: { supplierId: true, supplierName: true } },
      claims: {
        where: { status: { not: WarrantyClaimStatus.CANCELLED } },
        select: { claimNo: true },
      },
    },
  });
  if (!warranty) return { error: "ไม่พบข้อมูลประกัน" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warrantyEndDate = new Date(warranty.endDate);
  warrantyEndDate.setHours(0, 0, 0, 0);
  if (warrantyEndDate < today) {
    return { error: "รายการประกันนี้หมดอายุแล้ว ไม่สามารถเปิดเคลมได้" };
  }

  if (warranty.claims.length > 0) {
    return { error: `รายการประกันนี้มีใบเคลม ${warranty.claims[0].claimNo} ค้างอยู่แล้ว` };
  }

  const claimDate = new Date(data.claimDate);
  const claimNo = await generateClaimNo(claimDate);

  try {
    await dbTx(async (tx) => {
      const avgCost = await getAvgCost(tx, warranty.productId);
      const replacementOptions =
        warranty.product.isLotControl && data.claimType === ClaimType.REPLACE_NOW
          ? await getClaimReplacementLots(tx, warranty.productId)
          : [];
      const autoReplacementLot =
        warranty.product.isLotControl && data.claimType === ClaimType.REPLACE_NOW
          ? autoAllocateLots(replacementOptions, 1, 1)[0]
          : undefined;
      const selectedReplacementLotNo =
        normalizeOptionalString(data.replacementLotNo) ?? autoReplacementLot?.lotNo;
      const replacementLot = replacementOptions.find((lot) => lot.lotNo === selectedReplacementLotNo);

      if (warranty.product.isLotControl && data.claimType === ClaimType.REPLACE_NOW && !replacementLot?.lotNo) {
        throw new Error("ไม่พบ Lot คงเหลือสำหรับส่งสินค้าทดแทน");
      }

      const claim = await tx.warrantyClaim.create({
        data: {
          claimNo,
          warrantyId: data.warrantyId,
          claimDate,
          claimType: data.claimType,
          status: WarrantyClaimStatus.DRAFT,
          symptom: data.symptom,
          note: data.note,
          supplierId: data.supplierId || warranty.saleItem?.supplierId || null,
          supplierName: data.supplierName || warranty.saleItem?.supplierName || null,
          supplierPhone: data.supplierPhone || null,
          supplierAddress: data.supplierAddress || null,
        },
      });

      if (data.claimType === ClaimType.REPLACE_NOW || data.claimType === ClaimType.CUSTOMER_WAIT) {
        const returnStockCardId = await writeStockCard(tx, {
          productId: warranty.productId,
          docNo: claimNo,
          docDate: claimDate,
          source: "CLAIM_RETURN_IN",
          qtyIn: 1,
          qtyOut: 0,
          priceIn: avgCost,
          detail: `รับคืนสินค้าเคลม ${claimNo}`,
          referenceId: claim.id,
        });

        if (warranty.product.isLotControl && warranty.lotNo) {
          await writeClaimLot(tx, claim.id, warranty.productId, {
            lotNo: warranty.lotNo,
            qtyInBase: 1,
            unitCostBase: avgCost,
            mfgDate: null,
            expDate: null,
            direction: "in",
          });

          await writeStockMovementLots(
            tx,
            returnStockCardId,
            [{
              lotNo: warranty.lotNo,
              qtyInBase: 1,
              unitCostBase: avgCost,
              mfgDate: null,
              expDate: null,
            }],
            "in"
          );
        }
      }

      if (data.claimType === ClaimType.REPLACE_NOW) {
        const replaceStockCardId = await writeStockCard(tx, {
          productId: warranty.productId,
          docNo: claimNo,
          docDate: claimDate,
          source: "CLAIM_REPLACE_OUT",
          qtyIn: 0,
          qtyOut: 1,
          priceIn: 0,
          detail: `ส่งสินค้าใหม่แทนเคลม ${claimNo}`,
          referenceId: claim.id,
        });

        if (warranty.product.isLotControl && replacementLot?.lotNo) {
          await writeClaimLot(tx, claim.id, warranty.productId, {
            lotNo: replacementLot.lotNo,
            qtyInBase: 1,
            unitCostBase: replacementLot.unitCost,
            mfgDate: null,
            expDate: null,
            direction: "out",
          });

          await writeStockMovementLots(
            tx,
            replaceStockCardId,
            [{
              lotNo: replacementLot.lotNo,
              qtyInBase: 1,
              unitCostBase: replacementLot.unitCost,
              mfgDate: null,
              expDate: null,
            }],
            "out"
          );
        }
      }
    });

    revalidatePath("/admin/warranty-claims");
    return { claimNo };
  } catch (error) {
    if (error instanceof Error && error.message) return { error: error.message };
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
    symptom: formData.get("symptom") || undefined,
    note: formData.get("note") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    supplierName: formData.get("supplierName") || undefined,
    supplierPhone: formData.get("supplierPhone") || undefined,
    supplierAddress: formData.get("supplierAddress") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  try {
    await db.warrantyClaim.update({
      where: { id },
      data: {
        symptom: parsed.data.symptom ?? null,
        note: parsed.data.note ?? null,
        supplierId: parsed.data.supplierId || null,
        supplierName: parsed.data.supplierName || null,
        supplierPhone: parsed.data.supplierPhone || null,
        supplierAddress: parsed.data.supplierAddress || null,
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
      warranty: {
        select: {
          lotNo: true,
          productId: true,
          product: { select: { isLotControl: true } },
        },
      },
    },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status !== WarrantyClaimStatus.DRAFT) return { error: "สถานะไม่อนุญาตให้ส่งเคลม" };

  const sentDate = new Date(sentAt);
  const docNo = `${claim.claimNo}-S`;

  try {
    await dbTx(async (tx) => {
      const avgCost = await getAvgCost(tx, claim.warranty.productId);

      await tx.warrantyClaim.update({
        where: { id },
        data: { status: WarrantyClaimStatus.SENT_TO_SUPPLIER, sentAt: sentDate },
      });

      const stockCardId = await writeStockCard(tx, {
        productId: claim.warranty.productId,
        docNo,
        docDate: sentDate,
        source: "CLAIM_SEND_OUT",
        qtyIn: 0,
        qtyOut: 1,
        priceIn: 0,
        detail: `ส่งสินค้าเคลมไปซัพพลายเออร์ ${claim.claimNo}`,
        referenceId: id,
      });

      if (claim.warranty.product.isLotControl && claim.warranty.lotNo) {
        await writeClaimLot(tx, id, claim.warranty.productId, {
          lotNo: claim.warranty.lotNo,
          qtyInBase: 1,
          unitCostBase: avgCost,
          mfgDate: null,
          expDate: null,
          direction: "out",
        });

        await writeStockMovementLots(
          tx,
          stockCardId,
          [{
            lotNo: claim.warranty.lotNo,
            qtyInBase: 1,
            unitCostBase: avgCost,
            mfgDate: null,
            expDate: null,
          }],
          "out"
        );
      }
    });

    revalidatePath("/admin/warranty-claims");
    revalidatePath(`/admin/warranty-claims/${id}`);
    return {};
  } catch (error) {
    if (error instanceof Error && error.message) return { error: error.message };
    return { error: "เกิดข้อผิดพลาด" };
  }
}

export async function closeClaim(
  id: string,
  outcome: string,
  resolvedAt: string,
  note?: string,
  receivedLotNo?: string,
  receivedMfgDate?: string,
  receivedExpDate?: string
): Promise<{ error?: string }> {
  try {
    await requirePermission("warranty_claims.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsedOutcome = z.nativeEnum(ClaimOutcome).safeParse(outcome);
  if (!parsedOutcome.success) return { error: "ผลลัพธ์ไม่ถูกต้อง" };

  const receivedLotParsed = closeClaimReceivedLotSchema.safeParse({
    receivedLotNo: normalizeOptionalString(receivedLotNo),
    receivedMfgDate,
    receivedExpDate,
  });
  if (!receivedLotParsed.success) return { error: "ข้อมูล Lot รับกลับไม่ถูกต้อง" };

  const claim = await db.warrantyClaim.findUnique({
    where: { id },
    select: {
      claimNo: true,
      claimType: true,
      status: true,
      warranty: {
        select: {
          lotNo: true,
          productId: true,
          product: { select: { isLotControl: true } },
        },
      },
    },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status !== WarrantyClaimStatus.SENT_TO_SUPPLIER) {
    return { error: "ต้องส่งซัพพลายเออร์ก่อนปิดเคลม" };
  }

  const resolvedDate = new Date(resolvedAt);
  const docNo = `${claim.claimNo}-R`;
  const receivedLotNoValue = normalizeOptionalString(receivedLotParsed.data.receivedLotNo);
  const receivedMfg = normalizeOptionalDate(receivedLotParsed.data.receivedMfgDate);
  const receivedExp = normalizeOptionalDate(receivedLotParsed.data.receivedExpDate);

  if (parsedOutcome.data === ClaimOutcome.RECEIVED && claim.warranty.product.isLotControl && !receivedLotNoValue) {
    return { error: "กรุณาระบุ Lot ที่รับกลับจากซัพพลายเออร์" };
  }

  try {
    await dbTx(async (tx) => {
      const avgCost = await getAvgCost(tx, claim.warranty.productId);

      await tx.warrantyClaim.update({
        where: { id },
        data: {
          status: WarrantyClaimStatus.CLOSED,
          outcome: parsedOutcome.data,
          resolvedAt: resolvedDate,
          note: note || undefined,
        },
      });

      if (parsedOutcome.data === ClaimOutcome.RECEIVED) {
        const stockCardId = await writeStockCard(tx, {
          productId: claim.warranty.productId,
          docNo,
          docDate: resolvedDate,
          source: "CLAIM_RECV_IN",
          qtyIn: 1,
          qtyOut: 0,
          priceIn: avgCost,
          detail: `ได้รับสินค้าคืนจากซัพพลายเออร์ ${claim.claimNo}`,
          referenceId: id,
        });

        if (claim.warranty.product.isLotControl && receivedLotNoValue) {
          await writeClaimLot(tx, id, claim.warranty.productId, {
            lotNo: receivedLotNoValue,
            qtyInBase: 1,
            unitCostBase: avgCost,
            mfgDate: receivedMfg,
            expDate: receivedExp,
            direction: "in",
          });

          await writeStockMovementLots(
            tx,
            stockCardId,
            [{
              lotNo: receivedLotNoValue,
              qtyInBase: 1,
              unitCostBase: avgCost,
              mfgDate: receivedMfg,
              expDate: receivedExp,
            }],
            "in"
          );
        }

        if (claim.claimType === ClaimType.CUSTOMER_WAIT) {
          const replaceStockCardId = await writeStockCard(tx, {
            productId: claim.warranty.productId,
            docNo,
            docDate: resolvedDate,
            source: "CLAIM_REPLACE_OUT",
            qtyIn: 0,
            qtyOut: 1,
            priceIn: 0,
            detail: `ส่งสินค้าให้ลูกค้าที่รอเคลม ${claim.claimNo}`,
            referenceId: id,
          });

          if (claim.warranty.product.isLotControl && receivedLotNoValue) {
            await writeClaimLot(tx, id, claim.warranty.productId, {
              lotNo: receivedLotNoValue,
              qtyInBase: 1,
              unitCostBase: avgCost,
              mfgDate: receivedMfg,
              expDate: receivedExp,
              direction: "out",
            });

            await writeStockMovementLots(
              tx,
              replaceStockCardId,
              [{
                lotNo: receivedLotNoValue,
                qtyInBase: 1,
                unitCostBase: avgCost,
                mfgDate: receivedMfg,
                expDate: receivedExp,
              }],
              "out"
            );
          }
        }
      }
    });

    revalidatePath("/admin/warranty-claims");
    revalidatePath(`/admin/warranty-claims/${id}`);
    return {};
  } catch (error) {
    if (error instanceof Error && error.message) return { error: error.message };
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
  if (claim.status !== WarrantyClaimStatus.CLOSED) {
    return { error: "สามารถย้อนกลับได้เฉพาะสถานะปิดเคลม" };
  }

  try {
    await dbTx(async (tx) => {
      if (claim.outcome === ClaimOutcome.RECEIVED) {
        await reverseClaimLotBalance(tx, id, claim.warranty.productId, {
          docNos: [`${claim.claimNo}-R`],
        });
        await tx.stockCard.deleteMany({ where: { docNo: `${claim.claimNo}-R` } });
        await recalculateStockCard(tx, claim.warranty.productId);
      }

      await tx.warrantyClaim.update({
        where: { id },
        data: {
          status: WarrantyClaimStatus.SENT_TO_SUPPLIER,
          outcome: null,
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

export async function cancelClaimAction(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
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
      warranty: {
        select: {
          productId: true,
        },
      },
    },
  });
  if (!claim) return { error: "ไม่พบใบเคลม" };
  if (claim.status === WarrantyClaimStatus.CANCELLED) return { error: "ยกเลิกไปแล้ว" };

  try {
    await dbTx(async (tx) => {
      await reverseClaimLotBalance(tx, id, claim.warranty.productId);

      await tx.warrantyClaim.update({
        where: { id },
        data: { status: WarrantyClaimStatus.CANCELLED },
      });

      await tx.stockCard.deleteMany({ where: { referenceId: id } });
      await tx.stockCard.deleteMany({ where: { docNo: claim.claimNo } });
      await tx.stockCard.deleteMany({ where: { docNo: `${claim.claimNo}-S` } });
      await tx.stockCard.deleteMany({ where: { docNo: `${claim.claimNo}-R` } });
      await tx.stockCard.deleteMany({ where: { docNo: `${id}-SENT` } });
      await tx.stockCard.deleteMany({ where: { docNo: `${id}-RECV` } });

      await recalculateStockCard(tx, claim.warranty.productId);
    });

    revalidatePath("/admin/warranty-claims");
    revalidatePath(`/admin/warranty-claims/${id}`);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
}
