"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

const companySchema = z.object({
  shop_name: z.string().min(1, "กรุณาใส่ชื่อร้าน"),
  shop_slogan: z.string(),
  shop_address: z.string(),
  shop_phone: z.string(),
  shop_email: z.string(),
  shop_line_id: z.string(),
  shop_line_url: z.string(),
  shop_logo_url: z.string(),
  hero_title: z.string(),
  hero_subtitle: z.string(),
  shop_facebook_url: z.string(),
  shop_facebook_enabled: z.string(),
  shop_tiktok_url: z.string(),
  shop_tiktok_enabled: z.string(),
  shop_shopee_url: z.string(),
  shop_shopee_enabled: z.string(),
  shop_lazada_url: z.string(),
  shop_lazada_enabled: z.string(),
});

export async function updateCompanySettings(formData: FormData) {
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
