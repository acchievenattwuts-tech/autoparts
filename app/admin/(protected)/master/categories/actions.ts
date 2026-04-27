"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
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
  updateTag("storefront:categories");
  updateTag("storefront:products");
  updateTag("storefront-product-filters");
  updateTag("product-search");

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

async function getCategoryAuditSnapshot(id: string) {
  return db.category.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
    },
  });
}

export const createCategory = async (formData: FormData): Promise<{ error?: string }> => {
  const session = await requirePermission("master.create").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
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

    const afterSnapshot = await getCategoryAuditSnapshot(category.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "Category",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.slug ?? afterSnapshot.name,
        after: {
          ...afterSnapshot,
          iconKey,
          toneKey,
          motionKey,
        },
      });
    }

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
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
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
    const beforeSnapshot = await getCategoryAuditSnapshot(id);
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

    const afterSnapshot = await getCategoryAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(
        { ...beforeSnapshot, iconKey: null, toneKey: null, motionKey: null },
        { ...afterSnapshot, iconKey, toneKey, motionKey },
      );
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Category",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.slug ?? afterSnapshot.name,
        before: diff.before,
        after: diff.after,
      });
    }

    revalidatePath("/admin/master/categories");
    await refreshCategoryStorefrontCaches(id);
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขหมวดหมู่นี้ได้" };
  }
};

export const toggleCategory = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  const session = await requirePermission("master.cancel").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const beforeSnapshot = await getCategoryAuditSnapshot(id);
    const existingCategory = await db.category.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });

    if (!existingCategory) {
      return { error: "ไม่พบหมวดหมู่นี้" };
    }

    await db.category.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getCategoryAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "Category",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.slug ?? afterSnapshot.name,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }

    revalidatePath("/admin/master/categories");
    await refreshCategoryStorefrontCaches(id);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
