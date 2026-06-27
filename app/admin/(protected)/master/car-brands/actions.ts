"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { updateProductSearchCache } from "@/lib/product-search-cache";
import { triggerSearchKeywordRefresh } from "@/lib/search-keyword-index";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-auth";
import { ADMIN_MASTER_OPTION_TAGS } from "@/lib/admin-master-options";
import { invalidateCarBrandAliasCache } from "@/lib/car-brand-alias-cache";

const brandSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อยี่ห้อรถ").max(100),
});

const brandAliasSchema = z.object({
  alias: z.string().trim().min(1, "กรุณากรอก alias").max(120),
  notes: z.string().trim().max(500).optional(),
});

const modelSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อรุ่นรถ").max(100),
  carBrandId: z.string().min(1, "ไม่พบยี่ห้อรถ").max(50),
});

const refreshCarSearchCaches = async (filters?: {
  carBrandId?: string;
  carModelId?: string;
}) => {
  revalidatePath("/products");
  updateTag("storefront:products");
  updateTag("storefront-product-filters");
  updateProductSearchCache();
  triggerSearchKeywordRefresh();

  if (!filters?.carBrandId && !filters?.carModelId) {
    return;
  }
};

async function getCarBrandAuditSnapshot(id: string) {
  return db.carBrand.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  });
}

async function getCarBrandAliasAuditSnapshot(id: string) {
  return db.carBrandAlias.findUnique({
    where: { id },
    select: { id: true, carBrandId: true, alias: true, isActive: true, notes: true },
  });
}

async function getCarModelAuditSnapshot(id: string) {
  return db.carModel.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
      carBrandId: true,
      carBrand: {
        select: {
          name: true,
        },
      },
    },
  });
}

export const createCarBrand = async (formData: FormData): Promise<{ error?: string }> => {
  const session = await requirePermission("master.create").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const carBrand = await db.carBrand.create({ data: { name: parsed.data.name } });
    const afterSnapshot = await getCarBrandAuditSnapshot(carBrand.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "CarBrand",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        after: afterSnapshot,
      });
    }

    revalidatePath("/admin/master/car-brands");
    updateTag(ADMIN_MASTER_OPTION_TAGS.carBrands);
    await refreshCarSearchCaches();
    return {};
  } catch {
    return { error: "ชื่อยี่ห้อรถนี้มีอยู่แล้ว" };
  }
};

export const toggleCarBrand = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  const session = await requirePermission("master.cancel").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const beforeSnapshot = await getCarBrandAuditSnapshot(id);
    await db.carBrand.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getCarBrandAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "CarBrand",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }

    revalidatePath("/admin/master/car-brands");
    updateTag(ADMIN_MASTER_OPTION_TAGS.carBrands);
    await refreshCarSearchCaches({ carBrandId: id });
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};

export const createCarModel = async (formData: FormData): Promise<{ error?: string }> => {
  const session = await requirePermission("master.create").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  const parsed = modelSchema.safeParse({
    name: formData.get("name"),
    carBrandId: formData.get("carBrandId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const carModel = await db.carModel.create({
      data: { name: parsed.data.name, carBrandId: parsed.data.carBrandId },
    });
    const afterSnapshot = await getCarModelAuditSnapshot(carModel.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "CarModel",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        after: afterSnapshot,
      });
    }

    revalidatePath("/admin/master/car-brands");
    updateTag(ADMIN_MASTER_OPTION_TAGS.carBrands);
    await refreshCarSearchCaches({ carBrandId: parsed.data.carBrandId });
    return {};
  } catch {
    return { error: "ชื่อรุ่นรถนี้มีอยู่แล้วในยี่ห้อนี้" };
  }
};

export const toggleCarModel = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  const session = await requirePermission("master.cancel").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const beforeSnapshot = await getCarModelAuditSnapshot(id);
    const existingModel = await db.carModel.findUnique({
      where: { id },
      select: { carBrandId: true },
    });

    await db.carModel.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getCarModelAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "CarModel",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }

    revalidatePath("/admin/master/car-brands");
    updateTag(ADMIN_MASTER_OPTION_TAGS.carBrands);
    await refreshCarSearchCaches({
      carBrandId: existingModel?.carBrandId,
      carModelId: id,
    });
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};

export const createCarBrandAlias = async (
  carBrandId: string,
  formData: FormData,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!carBrandId || carBrandId.length > 50 || !/^[a-z0-9]+$/.test(carBrandId)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = brandAliasSchema.safeParse({
    alias: formData.get("alias"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const requestContext = await getRequestContext();
  const alias = parsed.data.alias.toLowerCase();
  const normalizedNotes = parsed.data.notes?.trim() || null;

  try {
    const brand = await db.carBrand.findUnique({
      where: { id: carBrandId },
      select: { id: true, name: true },
    });
    if (!brand) return { error: "ไม่พบยี่ห้อรถนี้" };

    const created = await db.carBrandAlias.create({
      data: { carBrandId, alias, notes: normalizedNotes },
    });

    const afterSnapshot = await getCarBrandAliasAuditSnapshot(created.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "CarBrandAlias",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.alias,
        after: afterSnapshot,
      });
    }

    invalidateCarBrandAliasCache();
    revalidatePath("/admin/master/car-brands");
    updateTag(ADMIN_MASTER_OPTION_TAGS.carBrands);
    await refreshCarSearchCaches({ carBrandId });
    return {};
  } catch {
    return { error: "ไม่สามารถเพิ่ม alias ได้ กรุณาตรวจสอบว่าคำนี้ซ้ำอยู่แล้วหรือไม่" };
  }
};

export const toggleCarBrandAlias = async (
  id: string,
  isActive: boolean,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const requestContext = await getRequestContext();
  try {
    const beforeSnapshot = await getCarBrandAliasAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบ alias นี้" };

    await db.carBrandAlias.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getCarBrandAliasAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "CarBrandAlias",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.alias,
        before: diff.before,
        after: diff.after,
      });
    }

    invalidateCarBrandAliasCache();
    revalidatePath("/admin/master/car-brands");
    updateTag(ADMIN_MASTER_OPTION_TAGS.carBrands);
    await refreshCarSearchCaches({ carBrandId: beforeSnapshot.carBrandId });
    return {};
  } catch {
    return { error: "ไม่สามารถเปลี่ยนสถานะ alias ได้" };
  }
};
