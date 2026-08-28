"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuditAction, PricePromotionStatus } from "@/lib/generated/prisma";
import { db, dbTx } from "@/lib/db";
import { getAuditActorFromSession, getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";
import { requirePermission } from "@/lib/require-auth";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { resolveSaleUnitCost } from "@/lib/inventory-tracking";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const itemSchema = z.object({
  productId: z.string().min(1).max(50),
  promotionPrice: z.coerce.number().min(0).max(9_999_999),
});
const draftSchema = z.object({
  name: z.string().trim().min(1).max(150),
  priceListId: z.string().min(1).max(50),
  startDate: z.string().regex(DATE_KEY_PATTERN),
  endDate: z.string().regex(DATE_KEY_PATTERN),
  note: z.string().trim().max(1000).optional(),
  items: z.array(itemSchema).min(1).max(1000),
});

const refresh = () => revalidatePath("/admin/pricing/promotions");

export async function createPricePromotionDraft(payload: unknown): Promise<{ error?: string }> {
  const session = await requirePermission("price_promotions.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.endDate < parsed.data.startDate) return { error: "วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่ม" };
  const uniqueProductIds = [...new Set(parsed.data.items.map((item) => item.productId))];
  if (uniqueProductIds.length !== parsed.data.items.length) return { error: "สินค้าในโปรโมชั่นห้ามซ้ำ" };

  try {
    const created = await dbTx(async (tx) => {
      const priceList = await tx.priceList.findFirst({
        where: { id: parsed.data.priceListId, isActive: true },
        select: { id: true },
      });
      if (!priceList) throw new Error("PRICE_LIST_NOT_ACTIVE");
      const normalPrices = await tx.productPrice.findMany({
        where: { priceListId: priceList.id, productId: { in: uniqueProductIds } },
        select: { productId: true, amount: true },
      });
      if (normalPrices.length !== uniqueProductIds.length) throw new Error("NORMAL_PRICE_MISSING");
      const normalByProduct = new Map(normalPrices.map((row) => [row.productId, row.amount]));
      return tx.pricePromotion.create({
        data: {
          name: parsed.data.name,
          priceListId: priceList.id,
          startDate: parseDateOnlyToDate(parsed.data.startDate),
          endDate: parseDateOnlyToDate(parsed.data.endDate),
          note: parsed.data.note || null,
          createdById: session.user.id,
          items: {
            create: parsed.data.items.map((item) => ({
              productId: item.productId,
              normalReferencePrice: normalByProduct.get(item.productId)!,
              promotionPrice: item.promotionPrice,
            })),
          },
        },
        include: { items: true },
      });
    });
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.CREATE,
      entityType: "PricePromotion",
      entityId: created.id,
      entityRef: created.name,
      after: created,
    });
    refresh();
    return {};
  } catch (error) {
    if (error instanceof Error && error.message === "PRICE_LIST_NOT_ACTIVE") return { error: "Price List ไม่ได้เปิดใช้งาน" };
    if (error instanceof Error && error.message === "NORMAL_PRICE_MISSING") return { error: "สินค้าบางรายการยังไม่มีราคาปกติใน Price List นี้" };
    return { error: "สร้าง draft โปรโมชั่นไม่สำเร็จ" };
  }
}

export async function updatePricePromotionDraft(id: string, payload: unknown): Promise<{ error?: string }> {
  const session = await requirePermission("price_promotions.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.endDate < parsed.data.startDate) return { error: "วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่ม" };
  const uniqueProductIds = [...new Set(parsed.data.items.map((item) => item.productId))];
  if (uniqueProductIds.length !== parsed.data.items.length) return { error: "สินค้าในโปรโมชั่นห้ามซ้ำ" };

  try {
    const result = await dbTx(async (tx) => {
      const current = await tx.pricePromotion.findUnique({ where: { id }, include: { items: true } });
      if (!current || current.status !== PricePromotionStatus.DRAFT) throw new Error("PROMOTION_NOT_DRAFT");
      const priceList = await tx.priceList.findFirst({ where: { id: parsed.data.priceListId, isActive: true }, select: { id: true } });
      if (!priceList) throw new Error("PRICE_LIST_NOT_ACTIVE");
      const normalPrices = await tx.productPrice.findMany({
        where: { priceListId: priceList.id, productId: { in: uniqueProductIds } },
        select: { productId: true, amount: true },
      });
      if (normalPrices.length !== uniqueProductIds.length) throw new Error("NORMAL_PRICE_MISSING");
      const normalByProduct = new Map(normalPrices.map((row) => [row.productId, row.amount]));
      const updated = await tx.pricePromotion.update({
        where: { id },
        data: {
          name: parsed.data.name,
          priceListId: priceList.id,
          startDate: parseDateOnlyToDate(parsed.data.startDate),
          endDate: parseDateOnlyToDate(parsed.data.endDate),
          note: parsed.data.note || null,
          items: {
            deleteMany: {},
            create: parsed.data.items.map((item) => ({
              productId: item.productId,
              normalReferencePrice: normalByProduct.get(item.productId)!,
              promotionPrice: item.promotionPrice,
            })),
          },
        },
        include: { items: true },
      });
      return { current, updated };
    });
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.UPDATE,
      entityType: "PricePromotion",
      entityId: result.updated.id,
      entityRef: result.updated.name,
      before: result.current,
      after: result.updated,
      meta: { event: "EDIT_DRAFT" },
    });
    refresh();
    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PROMOTION_NOT_DRAFT") return { error: "แก้ไขได้เฉพาะโปรโมชั่นสถานะ Draft" };
    if (message === "PRICE_LIST_NOT_ACTIVE") return { error: "Price List ไม่ได้เปิดใช้งาน" };
    if (message === "NORMAL_PRICE_MISSING") return { error: "สินค้าบางรายการยังไม่มีราคาปกติใน Price List นี้" };
    return { error: "แก้ไข draft โปรโมชั่นไม่สำเร็จ" };
  }
}

export async function publishPricePromotion(
  id: string,
  confirmBelowCost = false,
): Promise<{ error?: string; belowCostProducts?: string[] }> {
  const session = await requirePermission("price_promotions.publish").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  try {
    const published = await dbTx(async (tx) => {
      const promotion = await tx.pricePromotion.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: { select: { code: true, avgCost: true, costPrice: true, inventoryTracking: true } },
            },
          },
          priceList: { select: { isActive: true } },
        },
      });
      if (!promotion || promotion.status !== PricePromotionStatus.DRAFT) throw new Error("PROMOTION_NOT_DRAFT");
      if (!promotion.priceList.isActive) throw new Error("PRICE_LIST_NOT_ACTIVE");
      if (promotion.items.length === 0) throw new Error("PROMOTION_EMPTY");

      for (const productId of promotion.items.map((item) => item.productId).sort()) {
        const lockKey = `${promotion.priceListId}:${productId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      }

      const productIds = promotion.items.map((item) => item.productId);
      const currentNormalCount = await tx.productPrice.count({
        where: { priceListId: promotion.priceListId, productId: { in: productIds } },
      });
      if (currentNormalCount !== productIds.length) throw new Error("NORMAL_PRICE_MISSING");
      const overlap = await tx.pricePromotionItem.findFirst({
        where: {
          productId: { in: productIds },
          promotion: {
            id: { not: promotion.id },
            priceListId: promotion.priceListId,
            status: PricePromotionStatus.PUBLISHED,
            startDate: { lte: promotion.endDate },
            endDate: { gte: promotion.startDate },
          },
        },
        select: { product: { select: { code: true } } },
      });
      if (overlap) throw new Error(`PROMOTION_OVERLAP:${overlap.product.code}`);

      const belowCostProducts = promotion.items
        .filter((item) => Number(item.promotionPrice) < resolveSaleUnitCost(item.product))
        .map((item) => item.product.code);
      if (belowCostProducts.length > 0 && !confirmBelowCost) {
        throw new Error(`BELOW_COST:${belowCostProducts.join("|")}`);
      }
      return tx.pricePromotion.update({
        where: { id: promotion.id },
        data: { status: PricePromotionStatus.PUBLISHED, publishedAt: new Date(), publishedById: session.user.id },
      });
    });
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.UPDATE,
      entityType: "PricePromotion",
      entityId: published.id,
      entityRef: published.name,
      after: published,
      meta: { event: "PUBLISH" },
    });
    refresh();
    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("BELOW_COST:")) {
      return { error: "ราคาโปรโมชั่นต่ำกว่าทุน ต้องยืนยันอีกครั้ง", belowCostProducts: message.slice(11).split("|") };
    }
    if (message.startsWith("PROMOTION_OVERLAP:")) return { error: `ช่วงโปรโมชั่นซ้อนกับรายการที่เผยแพร่แล้ว: ${message.slice(18)}` };
    if (message === "NORMAL_PRICE_MISSING") return { error: "สินค้าบางรายการไม่มีราคาปกติใน Price List" };
    return { error: "โปรโมชั่นไม่อยู่ในสถานะ draft หรือข้อมูลไม่พร้อมเผยแพร่" };
  }
}

export async function cancelPricePromotion(id: string): Promise<{ error?: string }> {
  const session = await requirePermission("price_promotions.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const current = await db.pricePromotion.findUnique({ where: { id } });
  if (!current || current.status === PricePromotionStatus.CANCELLED) return { error: "ไม่พบโปรโมชั่นที่ยกเลิกได้" };
  const cancelled = await db.pricePromotion.update({
    where: { id },
    data: { status: PricePromotionStatus.CANCELLED, cancelledAt: new Date(), cancelledById: session.user.id },
  });
  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.CANCEL,
    entityType: "PricePromotion",
    entityId: cancelled.id,
    entityRef: cancelled.name,
    before: current,
    after: cancelled,
  });
  refresh();
  return {};
}
