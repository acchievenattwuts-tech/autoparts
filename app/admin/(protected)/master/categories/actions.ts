"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  categoryVisualInputSchema,
  saveCategoryVisualSetting,
} from "@/lib/category-visual-settings";
import { slugifyAsciiSegment } from "@/lib/product-slug";
import { requirePermission } from "@/lib/require-auth";
import { buildUniqueSlug } from "@/lib/slug-helpers";
import { refreshCategoryStorefrontCaches } from "@/lib/storefront-revalidation";

const categorySchema = z
  .object({
    name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่").max(100),
  })
  .merge(categoryVisualInputSchema);

const refreshCategorySearchCaches = async ({
  categoryId,
}: {
  categoryId?: string;
}) => {
  // Invalidate cached data via tags - this covers unstable_cache in
  // storefront-category.ts and any fetch-based caches tagged with these keys.
  // No need to revalidatePath for every category page individually;
  // tag invalidation ensures the next request gets fresh data.
  updateTag("storefront:categories");
  updateTag("storefront:products");
  updateTag("storefront-product-filters");
  updateTag("product-search");

  // Only revalidate pages that are always rendered (home, product index, sitemap).
  revalidatePath("/");
  revalidatePath("/products");
  revalidatePath("/sitemap.xml");
  revalidatePath("/products/[categorySlug]", "page");
  revalidatePath("/products/[categorySlug]/[productSlug]", "page");
  revalidatePath("/product/[productSlug]", "page");

  if (!categoryId) {
    return;
  }

  updateTag(`storefront-category:${categoryId}`);

  const productIds = await db.product.findMany({
    where: { categoryId },
    select: { id: true },
  });

  productIds.forEach(({ id }) => {
    updateTag(`storefront-product:${id}`);
  });
};

void refreshCategorySearchCaches;

export const createCategory = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    iconKey: formData.get("iconKey"),
    toneKey: formData.get("toneKey"),
    motionKey: formData.get("motionKey"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, iconKey, toneKey, motionKey } = parsed.data;

  try {
    const existingSlugs = await db.category.findMany({
      select: { slug: true },
    });

    const category = await db.category.create({
      data: {
        name,
        slug: buildUniqueSlug({
          value: name,
          taken: existingSlugs.flatMap(({ slug }) => (slug ? [slug] : [])),
          fallback: "category",
          slugify: slugifyAsciiSegment,
        }),
      },
    });

    await saveCategoryVisualSetting(category.id, { iconKey, toneKey, motionKey });
    revalidatePath("/admin/master/categories");
    await refreshCategoryStorefrontCaches(category.id);
    return {};
  } catch {
    return { error: "ไม่สามารถเพิ่มหมวดหมู่ได้ กรุณาตรวจสอบว่าชื่อนี้ซ้ำหรือไม่" };
  }
};

export const updateCategory = async (
  id: string,
  formData: FormData,
): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    iconKey: formData.get("iconKey"),
    toneKey: formData.get("toneKey"),
    motionKey: formData.get("motionKey"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, iconKey, toneKey, motionKey } = parsed.data;

  try {
    const existingCategory = await db.category.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });

    if (!existingCategory) {
      return { error: "ไม่พบหมวดหมู่นี้" };
    }

    await db.category.update({
      where: { id },
      data: { name },
    });
    await saveCategoryVisualSetting(id, { iconKey, toneKey, motionKey });

    revalidatePath("/admin/master/categories");
    await refreshCategoryStorefrontCaches(id);
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขหมวดหมู่ได้" };
  }
};

export const toggleCategory = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const existingCategory = await db.category.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });

    if (!existingCategory) {
      return { error: "ไม่พบหมวดหมู่นี้" };
    }

    await db.category.update({ where: { id }, data: { isActive } });

    revalidatePath("/admin/master/categories");
    await refreshCategoryStorefrontCaches(id);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
