"use server";

import { db } from "@/lib/db";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-auth";

const brandSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อยี่ห้อรถ").max(100),
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
  updateTag("product-search");

  if (!filters?.carBrandId && !filters?.carModelId) {
    return;
  }
};

export const createCarBrand = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db.carBrand.create({ data: { name: parsed.data.name } });
    revalidatePath("/admin/master/car-brands");
    await refreshCarSearchCaches();
    return {};
  } catch {
    return { error: "ชื่อยี่ห้อรถนี้มีอยู่แล้ว" };
  }
};

export const toggleCarBrand = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    await db.carBrand.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/master/car-brands");
    await refreshCarSearchCaches({ carBrandId: id });
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};

export const createCarModel = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = modelSchema.safeParse({
    name: formData.get("name"),
    carBrandId: formData.get("carBrandId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db.carModel.create({
      data: { name: parsed.data.name, carBrandId: parsed.data.carBrandId },
    });
    revalidatePath("/admin/master/car-brands");
    await refreshCarSearchCaches({ carBrandId: parsed.data.carBrandId });
    return {};
  } catch {
    return { error: "ชื่อรุ่นรถนี้มีอยู่แล้วในยี่ห้อนี้" };
  }
};

export const toggleCarModel = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const existingModel = await db.carModel.findUnique({
      where: { id },
      select: { carBrandId: true },
    });

    await db.carModel.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/master/car-brands");
    await refreshCarSearchCaches({
      carBrandId: existingModel?.carBrandId,
      carModelId: id,
    });
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
