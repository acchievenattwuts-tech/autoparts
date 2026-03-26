"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VatType } from "@/lib/generated/prisma";
import { calcVat } from "@/lib/vat";
import { generateExpenseNo } from "@/lib/doc-number";

const expenseItemSchema = z.object({
  expenseCodeId: z.string().min(1, "กรุณาเลือกรหัสค่าใช้จ่าย"),
  description:   z.string().max(200).optional(),
  amount:        z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
});

const expenseSchema = z.object({
  expenseDate: z.string().min(1, "กรุณาระบุวันที่"),
  vatType:     z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:     z.coerce.number().min(0).max(100).default(0),
  note:        z.string().max(500).optional(),
  items:       z.array(expenseItemSchema).min(1, "ต้องมีรายการค่าใช้จ่ายอย่างน้อย 1 รายการ").max(50),
});

export async function createExpense(
  formData: FormData
): Promise<{ success?: boolean; expenseNo?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof expenseItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = expenseSchema.safeParse({
    expenseDate: formData.get("expenseDate"),
    vatType:     (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:     formData.get("vatRate") || 0,
    note:        formData.get("note") || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const d = parsed.data;
  const totalAmount = d.items.reduce((sum, it) => sum + it.amount, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, d.vatType, d.vatRate);
  const docDate   = new Date(d.expenseDate);
  const expenseNo = await generateExpenseNo(docDate);

  try {
    await db.expense.create({
      data: {
        expenseNo,
        expenseDate:    docDate,
        userId:         session.user.id!,
        totalAmount,
        vatType:        d.vatType,
        vatRate:        d.vatRate,
        subtotalAmount,
        vatAmount,
        netAmount,
        note:           d.note,
        items: {
          create: d.items.map((it) => ({
            expenseCodeId: it.expenseCodeId,
            description:   it.description || null,
            amount:        it.amount,
          })),
        },
      },
    });

    revalidatePath("/admin/expenses");
    return { success: true, expenseNo };
  } catch (err) {
    console.error("[createExpense]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelExpenseSchema = z.object({
  expenseId:  z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelExpense(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelExpenseSchema.safeParse({
    expenseId:  formData.get("expenseId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const { expenseId, cancelNote } = parsed.data;

  try {
    const expense = await db.expense.findUnique({ where: { id: expenseId } });
    if (!expense)                        return { error: "ไม่พบเอกสาร" };
    if (expense.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

    await db.expense.update({
      where: { id: expenseId },
      data:  { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
    });
    revalidatePath("/admin/expenses");
    return { success: true };
  } catch (err) {
    console.error("[cancelExpense]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
