"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/require-auth";

const urlOrEmpty = z.string().max(500).refine(
  (v) => v === "" || /^https?:\/\/.+/.test(v),
  { message: "URL ต้องเริ่มต้นด้วย http:// หรือ https://" }
);

const companySchema = z.object({
  shop_name: z.string().min(1, "กรุณาใส่ชื่อร้าน").max(100),
  shop_slogan: z.string().max(200),
  shop_address: z.string().max(500),
  shop_phone: z.string().max(20),
  shop_email: z.string().max(100),
  shop_line_id: z.string().max(50),
  shop_line_url: urlOrEmpty,
  shop_logo_url: urlOrEmpty,
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
});

export async function updateCompanySettings(formData: FormData) {
  try {
    await requireAuth();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = companySchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const entries = Object.entries(parsed.data) as [string, string][];
  await Promise.all(
    entries.map(([key, value]) =>
      db.siteContent.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );

  revalidatePath("/", "layout");
  revalidatePath("/admin/settings/company");
  return { success: true };
}
