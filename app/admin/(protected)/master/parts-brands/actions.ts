"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";

const brandSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อแบรนด์").max(100),
});

export const createPartsBrand = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requireAuth();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db.partsBrand.create({ data: { name: parsed.data.name } });
    revalidatePath("/admin/master/parts-brands");
    return {};
  } catch {
    return { error: "ชื่อแบรนด์นี้มีอยู่แล้ว" };
  }
};

export const deletePartsBrand = async (id: string): Promise<{ error?: string }> => {
  try {
    await requireAuth();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    await db.partsBrand.delete({ where: { id } });
    revalidatePath("/admin/master/parts-brands");
    return {};
  } catch {
    return { error: "ไม่สามารถลบแบรนด์นี้ได้ อาจมีสินค้าที่ใช้แบรนด์นี้อยู่" };
  }
};
