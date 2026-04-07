"use server";

import { db } from "@/lib/db";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-auth";
import { getCategoryPath } from "@/lib/product-slug";
import { buildUniqueSlug } from "@/lib/slug-helpers";

const categorySchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่").max(100),
});

const buildRevalidationPathVariants = (path: string) => {
  const variants = new Set<string>([path]);
  variants.add(encodeURI(path));
  return [...variants];
};

const refreshCategorySearchCaches = async ({
  categoryId,
  categoryPaths = [],
}: {
  categoryId?: string;
  categoryPaths?: string[];
}) => {
  revalidatePath("/");
  revalidatePath("/products");
  revalidatePath("/sitemap.xml");
  categoryPaths.flatMap(buildRevalidationPathVariants).forEach((path) => revalidatePath(path));
  updateTag("storefront:categories");
  updateTag("storefront:products");
  updateTag("storefront-product-filters");
  updateTag("product-search");

  if (!categoryId) {
    return;
  }

  const productIds = await db.product.findMany({
    where: { categoryId },
    select: { id: true },
  });

  productIds.forEach(({ id }) => {
    updateTag(`storefront-product:${id}`);
  });
};

export const createCategory = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    const existingSlugs = await db.category.findMany({
      select: { slug: true },
    });

    const category = await db.category.create({
      data: {
        name: parsed.data.name,
        slug: buildUniqueSlug({
          value: parsed.data.name,
          taken: existingSlugs.flatMap(({ slug }) => (slug ? [slug] : [])),
          fallback: "category",
        }),
      },
    });

    revalidatePath("/admin/master/categories");
    await refreshCategorySearchCaches({
      categoryId: category.id,
      categoryPaths: [getCategoryPath(category)],
    });
    return {};
  } catch {
    return { error: "ชื่อหมวดหมู่นี้มีอยู่แล้ว" };
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

  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

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
      data: { name: parsed.data.name },
    });

    revalidatePath("/admin/master/categories");
    await refreshCategorySearchCaches({
      categoryId: id,
      categoryPaths: [getCategoryPath(existingCategory)],
    });
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขชื่อหมวดหมู่ได้" };
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
    await refreshCategorySearchCaches({
      categoryId: id,
      categoryPaths: [getCategoryPath(existingCategory)],
    });
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
