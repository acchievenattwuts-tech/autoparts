"use server";

import { db } from "@/lib/db";
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

export const createPartsBrand = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db.partsBrand.create({ data: { name: parsed.data.name } });
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
  try {
    await requirePermission("master.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db.partsBrand.update({
      where: { id },
      data: { name: parsed.data.name },
    });
    revalidatePath("/admin/master/parts-brands");
    await refreshPartsBrandSearchCaches(id);
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขชื่อแบรนด์ได้ หรือชื่อนี้มีอยู่แล้ว" };
  }
};

export const togglePartsBrand = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    await db.partsBrand.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/master/parts-brands");
    await refreshPartsBrandSearchCaches(id);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
