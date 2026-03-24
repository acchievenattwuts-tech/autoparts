"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const brandSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อยี่ห้อรถ"),
});

const modelSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อรุ่นรถ"),
  carBrandId: z.string().min(1, "ไม่พบยี่ห้อรถ"),
});

export const createCarBrand = async (formData: FormData): Promise<{ error?: string }> => {
  const parsed = brandSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await db.carBrand.create({
      data: { name: parsed.data.name },
    });
    revalidatePath("/admin/master/car-brands");
    return {};
  } catch {
    return { error: "ชื่อยี่ห้อรถนี้มีอยู่แล้ว" };
  }
};

export const deleteCarBrand = async (id: string): Promise<{ error?: string }> => {
  try {
    await db.carBrand.delete({ where: { id } });
    revalidatePath("/admin/master/car-brands");
    return {};
  } catch {
    return { error: "ไม่สามารถลบยี่ห้อรถนี้ได้ อาจมีข้อมูลที่เกี่ยวข้องอยู่" };
  }
};

export const createCarModel = async (formData: FormData): Promise<{ error?: string }> => {
  const parsed = modelSchema.safeParse({
    name: formData.get("name"),
    carBrandId: formData.get("carBrandId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await db.carModel.create({
      data: {
        name: parsed.data.name,
        carBrandId: parsed.data.carBrandId,
      },
    });
    revalidatePath("/admin/master/car-brands");
    return {};
  } catch {
    return { error: "ชื่อรุ่นรถนี้มีอยู่แล้วในยี่ห้อนี้" };
  }
};

export const deleteCarModel = async (id: string): Promise<{ error?: string }> => {
  try {
    await db.carModel.delete({ where: { id } });
    revalidatePath("/admin/master/car-brands");
    return {};
  } catch {
    return { error: "ไม่สามารถลบรุ่นรถนี้ได้ อาจมีข้อมูลสินค้าที่เกี่ยวข้องอยู่" };
  }
};
