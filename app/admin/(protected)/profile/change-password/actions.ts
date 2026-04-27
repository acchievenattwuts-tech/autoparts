"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { getRequiredSession } from "@/lib/require-auth";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
    newPassword: z.string().min(8, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร").max(100),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่านใหม่"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "ยืนยันรหัสผ่านใหม่ไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export async function changeOwnPassword(
  formData: FormData
): Promise<{ success?: boolean; requireReLogin?: boolean; error?: string }> {
  let session;
  try {
    session = await getRequiredSession();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { currentPassword, newPassword } = parsed.data;

  try {
    const requestContext = await getRequestContext();
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, username: true, password: true },
    });

    if (!user) {
      return { error: "ไม่พบบัญชีผู้ใช้" };
    }

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return { error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.user.update({
      where: { id: session.user.id },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
      },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.PASSWORD_CHANGE,
      entityType: "User",
      entityId: user.id,
      entityRef: user.username ?? user.email,
      meta: { mustChangePasswordCleared: true },
    });

    return { success: true, requireReLogin: true };
  } catch (error) {
    console.error("[changeOwnPassword]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
