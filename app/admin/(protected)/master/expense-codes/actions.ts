"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateExpenseCodeCode } from "@/lib/entity-code";

const expenseCodeSchema = z.object({
  name:        z.string().min(1, "กรุณาระบุชื่อ").max(100),
  description: z.string().max(200).optional(),
});

export async function createExpenseCode(
  formData: FormData
): Promise<{ success?: boolean; code?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = expenseCodeSchema.safeParse({
    name:        formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const code = await generateExpenseCodeCode();

  try {
    await db.expenseCode.create({ data: { code, ...parsed.data } });
    revalidatePath("/admin/master/expense-codes");
    return { success: true, code };
  } catch (err: unknown) {
    console.error("[createExpenseCode]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function toggleExpenseCode(
  id: string,
  isActive: boolean
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  try {
    await db.expenseCode.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/master/expense-codes");
    return { success: true };
  } catch (err) {
    console.error("[toggleExpenseCode]", err);
    return { error: "เกิดข้อผิดพลาด" };
  }
}

export async function deleteExpenseCode(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  try {
    const inUse = await db.expenseItem.count({ where: { expenseCodeId: id } });
    if (inUse > 0) return { error: "ไม่สามารถลบได้ เนื่องจากมีรายการค่าใช้จ่ายอ้างอิงอยู่" };
    await db.expenseCode.delete({ where: { id } });
    revalidatePath("/admin/master/expense-codes");
    return { success: true };
  } catch (err) {
    console.error("[deleteExpenseCode]", err);
    return { error: "เกิดข้อผิดพลาด" };
  }
}
