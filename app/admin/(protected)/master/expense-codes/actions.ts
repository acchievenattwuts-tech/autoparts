"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateExpenseCodeCode } from "@/lib/entity-code";

const expenseCodeSchema = z.object({
  name:        z.string().min(1, "กรุณาระบุชื่อ").max(100),
  description: z.string().max(200).optional(),
});

async function getExpenseCodeAuditSnapshot(id: string) {
  return db.expenseCode.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isActive: true,
    },
  });
}

export async function createExpenseCode(
  formData: FormData
): Promise<{ success?: boolean; code?: string; error?: string }> {
  const session = await requirePermission("master.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  const parsed = expenseCodeSchema.safeParse({
    name:        formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const code = await generateExpenseCodeCode();

  try {
    const created = await db.expenseCode.create({ data: { code, ...parsed.data } });
    const afterSnapshot = await getExpenseCodeAuditSnapshot(created.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "ExpenseCode",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.code,
        after: afterSnapshot,
      });
    }
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

  const requestContext = await getRequestContext();

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = expenseCodeSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  try {
    const beforeSnapshot = await getExpenseCodeAuditSnapshot(id);
    await db.expenseCode.update({
      where: { id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      },
    });
    const afterSnapshot = await getExpenseCodeAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "ExpenseCode",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.code,
        before: diff.before,
        after: diff.after,
      });
    }
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

  const requestContext = await getRequestContext();

  try {
    const beforeSnapshot = await getExpenseCodeAuditSnapshot(id);
    await db.expenseCode.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getExpenseCodeAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "ExpenseCode",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.code,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }
    revalidatePath("/admin/master/expense-codes");
    return { success: true };
  } catch (err) {
    console.error("[toggleExpenseCode]", err);
    return { error: "เกิดข้อผิดพลาด" };
  }
}
