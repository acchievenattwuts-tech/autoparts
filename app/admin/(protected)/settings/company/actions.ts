"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { requirePermission } from "@/lib/require-auth";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

export async function uploadLogoImage(
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  try {
    await requirePermission("settings.company.manage");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "กรุณาเลือกไฟล์รูปภาพ" };
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { error: "อนุญาตเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, GIF)" };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: "ขนาดไฟล์ต้องไม่เกิน 3MB" };
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { error: "นามสกุลไฟล์ไม่ถูกต้อง ใช้ได้: jpg, png, webp, gif" };
  }

  const supabaseUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { error: "ไม่พบการตั้งค่า Supabase" };
  }

  try {
    const supabase    = createClient(supabaseUrl, supabaseServiceKey);
    const safeFileName = `logo-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const filePath    = `settings/${safeFileName}`;
    const buffer      = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("products")
      .upload(filePath, buffer, { contentType: file.type, upsert: false });

    if (uploadError) return { error: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

    const { data: { publicUrl } } = supabase.storage.from("products").getPublicUrl(filePath);
    return { url: publicUrl };
  } catch {
    return { error: "เกิดข้อผิดพลาดขณะอัปโหลดรูปภาพ" };
  }
}

const urlOrEmpty = z.string().max(500).refine(
  (v) => v === "" || /^https?:\/\/.+/.test(v),
  { message: "URL ต้องเริ่มต้นด้วย http:// หรือ https://" }
);

const companySchema = z.object({
  shop_name: z.string().min(1, "กรุณาใส่ชื่อร้าน").max(100),
  shop_slogan: z.string().max(200),
  shop_address: z.string().max(500),
  shop_phone: z.string().max(20),
  shop_phone_secondary: z.string().max(20),
  shop_email: z.string().max(100),
  shop_line_id: z.string().max(50),
  shop_line_url: urlOrEmpty,
  shop_logo_url: urlOrEmpty,
  shop_google_map_url: urlOrEmpty,
  shop_google_map_embed_url: urlOrEmpty,
  shop_business_hours: z.string().max(200),
  shop_holiday_note: z.string().max(300),
  shop_contact_note: z.string().max(500),
  hero_title: z.string().max(100),
  hero_subtitle: z.string().max(300),
  shop_facebook_url: urlOrEmpty,
  shop_facebook_enabled: z.enum(["true", "false"]),
  shop_tiktok_url: urlOrEmpty,
  shop_tiktok_enabled: z.enum(["true", "false"]),
  shop_shopee_url: urlOrEmpty,
  shop_shopee_enabled: z.enum(["true", "false"]),
  shop_lazada_url: urlOrEmpty,
  shop_lazada_enabled: z.enum(["true", "false"]),
  vat_type: z.enum(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"]),
  vat_rate: z.coerce.number().min(0).max(100).transform(String),
});

export async function updateCompanySettings(formData: FormData) {
  try {
    await requirePermission("settings.company.manage");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = companySchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const entries = Object.entries(parsed.data) as [string, string][];
    for (const [key, value] of entries) {
      await db.siteContent.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }
  } catch (error) {
    console.error("Failed to update company settings", error);
    return { error: "บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidateTag("site-config", "max");
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings/company");
  return { success: true };
}
