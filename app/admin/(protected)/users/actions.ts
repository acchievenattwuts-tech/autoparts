"use server";

import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureAccessControlSetup } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";

const ALLOWED_SIGNATURE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_SIGNATURE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const MAX_SIGNATURE_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

const optionalImageUrl = z
  .string()
  .max(500)
  .refine((value) => value === "" || /^https?:\/\/.+/.test(value), {
    message: "URL ลายเซ็นต้องเริ่มต้นด้วย http:// หรือ https://",
  });

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
  signatureUrl: optionalImageUrl.optional(),
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
    signatureUrl: formData.get("signatureUrl") || "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, username, password, role, appRoleId, mustChangePassword, signatureUrl } = parsed.data;

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
        signatureUrl: signatureUrl || null,
        signatureUpdatedAt: signatureUrl ? new Date() : null,
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
    signatureUrl: formData.get("signatureUrl") || "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, username, password, role, appRoleId, mustChangePassword, signatureUrl } = parsed.data;

  try {
    const existingUser = await db.user.findUnique({
      where: { id },
      select: { signatureUrl: true },
    });
    const hasSignatureChanged = (existingUser?.signatureUrl ?? "") !== signatureUrl;

    await db.user.update({
      where: { id },
      data: {
        name,
        username,
        email: username,
        role,
        appRoleId: appRoleId || null,
        mustChangePassword,
        signatureUrl: signatureUrl || null,
        ...(hasSignatureChanged
          ? { signatureUpdatedAt: signatureUrl ? new Date() : null }
          : {}),
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

export async function uploadUserSignature(
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  try {
    await requireAnyPermission(["admin.users.create", "admin.users.update"]);
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "กรุณาเลือกไฟล์ลายเซ็น" };
  }

  if (!ALLOWED_SIGNATURE_MIME_TYPES.includes(file.type)) {
    return { error: "อนุญาตเฉพาะไฟล์ภาพลายเซ็น JPG, PNG หรือ WebP" };
  }

  if (file.size > MAX_SIGNATURE_FILE_SIZE_BYTES) {
    return { error: "ขนาดไฟล์ลายเซ็นต้องไม่เกิน 3MB" };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_SIGNATURE_EXTENSIONS.includes(extension)) {
    return { error: "นามสกุลไฟล์ลายเซ็นไม่ถูกต้อง ใช้ได้: jpg, png, webp" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { error: "ไม่พบการตั้งค่า Supabase" };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const safeFileName = `user-signature-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const filePath = `users/signatures/${safeFileName}`;
    const buffer = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("products")
      .upload(filePath, buffer, { contentType: file.type, upsert: false });

    if (uploadError) {
      return { error: "อัปโหลดลายเซ็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("products").getPublicUrl(filePath);

    return { url: publicUrl };
  } catch {
    return { error: "เกิดข้อผิดพลาดขณะอัปโหลดลายเซ็น" };
  }
}
