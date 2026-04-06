"use server";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
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
  const session = await requirePermission("master.create").catch(() => null);
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

export async function updateExpenseCode(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = expenseCodeSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  try {
    await db.expenseCode.update({
      where: { id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      },
    });
    revalidatePath("/admin/master/expense-codes");
    return { success: true };
  } catch (err) {
    console.error("[updateExpenseCode]", err);
    return { error: "ไม่สามารถแก้ไขรหัสค่าใช้จ่ายได้" };
  }
}

export async function toggleExpenseCode(
  id: string,
  isActive: boolean
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("master.cancel").catch(() => null);
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
