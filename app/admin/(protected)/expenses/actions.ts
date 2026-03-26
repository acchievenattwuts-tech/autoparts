"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VatType, ExpenseCategory } from "@/lib/generated/prisma";
import { calcVat } from "@/lib/vat";

const expenseSchema = z.object({
  expenseDate:  z.string().min(1),
  category:     z.nativeEnum(ExpenseCategory),
  description:  z.string().min(1, "กรุณาระบุรายละเอียด").max(200),
  amount:       z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
  vatType:      z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:      z.coerce.number().min(0).max(100).default(0),
  note:         z.string().max(500).optional(),
});

export async function createExpense(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = expenseSchema.safeParse({
    expenseDate:  formData.get("expenseDate"),
    category:     formData.get("category"),
    description:  formData.get("description"),
    amount:       formData.get("amount"),
    vatType:      formData.get("vatType"),
    vatRate:      formData.get("vatRate"),
    note:         formData.get("note") || undefined,
  });

  if (!parsed.success) return { error: parsed.error.flatten().formErrors[0] ?? parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const d = parsed.data;

  const { subtotalAmount, vatAmount, netAmount } = calcVat(d.amount, d.vatType, d.vatRate);

  try {
    await db.expense.create({
      data: {
        expenseDate:    new Date(d.expenseDate),
        category:       d.category,
        description:    d.description,
        amount:         netAmount,
        subtotalAmount,
        vatAmount,
        vatType:        d.vatType,
        vatRate:        d.vatRate,
        note:           d.note,
        userId:         session.user.id,
      },
    });

    revalidatePath("/admin/expenses");
    return { success: true };
  } catch (err) {
    console.error("[createExpense]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function deleteExpense(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  try {
    await db.expense.delete({ where: { id } });
    revalidatePath("/admin/expenses");
    return { success: true };
  } catch (err) {
    console.error("[deleteExpense]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
