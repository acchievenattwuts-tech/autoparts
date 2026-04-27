"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-auth";

const brandSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อแบรนด์").max(100),
});

const refreshPartsBrandSearchCaches = async (brandId?: string) => {
  updateTag("storefront:products");
  updateTag("storefront-product-filters");
  revalidatePath("/products");
  revalidatePath("/sitemap.xml");
  updateTag("product-search");

  if (!brandId) {
    return;
  }

  const productIds = await db.product.findMany({
    where: { brandId },
    select: { id: true },
  });

  productIds.forEach(({ id }) => {
    updateTag(`storefront-product:${id}`);
  });
};

async function getPartsBrandAuditSnapshot(id: string) {
  return db.partsBrand.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  });
}

export const createPartsBrand = async (formData: FormData): Promise<{ error?: string }> => {
  const session = await requirePermission("master.create").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const partsBrand = await db.partsBrand.create({ data: { name: parsed.data.name } });
    const afterSnapshot = await getPartsBrandAuditSnapshot(partsBrand.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "PartsBrand",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        after: afterSnapshot,
      });
    }

    revalidatePath("/admin/master/parts-brands");
    await refreshPartsBrandSearchCaches();
    return {};
  } catch {
    return { error: "ชื่อแบรนด์นี้มีอยู่แล้ว" };
  }
};

export const updatePartsBrand = async (
  id: string,
  formData: FormData,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const beforeSnapshot = await getPartsBrandAuditSnapshot(id);
    await db.partsBrand.update({
      where: { id },
      data: { name: parsed.data.name },
    });
    const afterSnapshot = await getPartsBrandAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "PartsBrand",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        before: diff.before,
        after: diff.after,
      });
    }

    revalidatePath("/admin/master/parts-brands");
    await refreshPartsBrandSearchCaches(id);
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขชื่อแบรนด์ได้ หรือชื่อนี้มีอยู่แล้ว" };
  }
};

export const togglePartsBrand = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  const session = await requirePermission("master.cancel").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const beforeSnapshot = await getPartsBrandAuditSnapshot(id);
    await db.partsBrand.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getPartsBrandAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "PartsBrand",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }

    revalidatePath("/admin/master/parts-brands");
    await refreshPartsBrandSearchCaches(id);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
