"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-auth";

const categorySchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่").max(100),
});

export const createCategory = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db.category.create({ data: { name: parsed.data.name } });
    revalidatePath("/admin/master/categories");
    return {};
  } catch {
    return { error: "ชื่อหมวดหมู่นี้มีอยู่แล้ว" };
  }
};

export const toggleCategory = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    await db.category.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/master/categories");
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
