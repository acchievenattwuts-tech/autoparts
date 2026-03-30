"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureAccessControlSetup } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";

const userSchema = z.object({
  name: z.string().min(1, "กรุณาระบุชื่อผู้ใช้").max(100),
  username: z
    .string()
    .min(1, "กรุณาระบุชื่อผู้ใช้สำหรับเข้าสู่ระบบ")
    .max(100)
    .transform((value) => value.trim().toLowerCase()),
  role: z.enum(["ADMIN", "STAFF"]),
  appRoleId: z.string().max(50).optional(),
  mustChangePassword: z.boolean().default(false),
});

const createUserSchema = userSchema.extend({
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร").max(100),
});

const updateUserSchema = userSchema.extend({
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร").max(100).optional(),
});

export async function createUser(
  formData: FormData
): Promise<{ success?: boolean; id?: string; error?: string }> {
  await ensureAccessControlSetup();

  try {
    await requirePermission("admin.users.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
    role: formData.get("role"),
    appRoleId: formData.get("appRoleId") || undefined,
    mustChangePassword: formData.get("mustChangePassword") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, username, password, role, appRoleId, mustChangePassword } = parsed.data;

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: {
        name,
        username,
        email: username,
        password: hashedPassword,
        role,
        appRoleId: appRoleId || null,
        mustChangePassword,
      },
      select: { id: true },
    });

    revalidatePath("/admin/users");
    return { success: true, id: user.id };
  } catch (error) {
    console.error("[createUser]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function updateUser(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  await ensureAccessControlSetup();

  try {
    await requirePermission("admin.users.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    password: (formData.get("password") as string) || undefined,
    role: formData.get("role"),
    appRoleId: formData.get("appRoleId") || undefined,
    mustChangePassword: formData.get("mustChangePassword") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, username, password, role, appRoleId, mustChangePassword } = parsed.data;

  try {
    await db.user.update({
      where: { id },
      data: {
        name,
        username,
        email: username,
        role,
        appRoleId: appRoleId || null,
        mustChangePassword,
        ...(password ? { password: await bcrypt.hash(password, 12) } : {}),
      },
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${id}/edit`);
    return { success: true };
  } catch (error) {
    console.error("[updateUser]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function toggleUserActive(
  id: string,
  isActive: boolean
): Promise<{ success?: boolean; error?: string }> {
  try {
    await requirePermission("admin.users.manage");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  try {
    await db.user.update({
      where: { id },
      data: { isActive },
    });
    revalidatePath("/admin/users");
    return { success: true };
  } catch (error) {
    console.error("[toggleUserActive]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
