"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const categorySchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่"),
});

export const createCategory = async (formData: FormData): Promise<{ error?: string }> => {
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await db.category.create({
      data: { name: parsed.data.name },
    });
    revalidatePath("/admin/master/categories");
    return {};
  } catch {
    return { error: "ชื่อหมวดหมู่นี้มีอยู่แล้ว" };
  }
};

export const deleteCategory = async (id: string): Promise<{ error?: string }> => {
  try {
    await db.category.delete({ where: { id } });
    revalidatePath("/admin/master/categories");
    return {};
  } catch {
    return { error: "ไม่สามารถลบหมวดหมู่นี้ได้ อาจมีสินค้าอยู่ในหมวดหมู่นี้" };
  }
};
