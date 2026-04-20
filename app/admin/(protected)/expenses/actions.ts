"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VatType } from "@/lib/generated/prisma";
import { calcVat } from "@/lib/vat";
import { generateExpenseNo } from "@/lib/doc-number";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { rebuildExpenseProfitFacts } from "@/lib/profit-fact";

const expenseItemSchema = z.object({
  expenseCodeId: z.string().min(1, "กรุณาเลือกรหัสค่าใช้จ่าย"),
  description:   z.string().max(200).optional(),
  amount:        z.coerce.number().positive("จำนวนเงินต้องมากกว่า 0"),
});

const expenseSchema = z.object({
  expenseDate: z.string().min(1, "กรุณาระบุวันที่"),
  cashBankAccountId: z.string().min(1, "กรุณาเลือกบัญชีจ่ายเงิน"),
  vatType:     z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:     z.coerce.number().min(0).max(100).default(0),
  note:        z.string().max(500).optional(),
  items:       z.array(expenseItemSchema).min(1, "ต้องมีรายการค่าใช้จ่ายอย่างน้อย 1 รายการ").max(50),
});

export async function createExpense(
  formData: FormData
): Promise<{ success?: boolean; expenseNo?: string; error?: string }> {
  const session = await requirePermission("expenses.create").catch(() => null);
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
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
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
    await dbTx(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          expenseNo,
          expenseDate:    docDate,
          userId:         session.user.id!,
          cashBankAccountId: d.cashBankAccountId,
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

      await replaceCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, expense.id, [{
        accountId: d.cashBankAccountId,
        txnDate: docDate,
        direction: CashBankDirection.OUT,
        amount: netAmount,
        referenceNo: expenseNo,
        note: d.note ?? null,
      }]);

      await rebuildExpenseProfitFacts(tx, expense.id);
    });

    revalidatePath("/admin");
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
  const session = await requirePermission("expenses.cancel").catch(() => null);
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

    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, expenseId);
      await tx.expense.update({
        where: { id: expenseId },
        data:  { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
      });
      await rebuildExpenseProfitFacts(tx, expenseId);
    });
    revalidatePath("/admin");
    revalidatePath("/admin/expenses");
    return { success: true };
  } catch (err) {
    console.error("[cancelExpense]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateExpense
// ─────────────────────────────────────────

export async function updateExpense(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("expenses.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.expense.findUnique({ where: { id } });
  if (!existing)                       return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  let items: z.infer<typeof expenseItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

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
  const docDate = new Date(d.expenseDate);

  try {
    await dbTx(async (tx) => {
      await tx.expenseItem.deleteMany({ where: { expenseId: id } });
      await tx.expense.update({
        where: { id },
        data: {
          expenseDate:    docDate,
          cashBankAccountId: d.cashBankAccountId,
          totalAmount,
          vatType:        d.vatType,
          vatRate:        d.vatRate,
          subtotalAmount,
          vatAmount,
          netAmount,
          note:           d.note ?? null,
        },
      });
      await tx.expenseItem.createMany({
        data: d.items.map((it) => ({
          expenseId:     id,
          expenseCodeId: it.expenseCodeId,
          description:   it.description || null,
          amount:        it.amount,
        })),
      });

      await replaceCashBankSourceMovements(tx, CashBankSourceType.EXPENSE, id, [{
        accountId: d.cashBankAccountId,
        txnDate: docDate,
        direction: CashBankDirection.OUT,
        amount: netAmount,
        referenceNo: existing.expenseNo,
        note: d.note ?? null,
      }]);

      await rebuildExpenseProfitFacts(tx, id);
    });

    revalidatePath("/admin");
    revalidatePath("/admin/expenses");
    revalidatePath(`/admin/expenses/${id}`);
    return { success: true };
  } catch (err) {
    console.error("[updateExpense]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
