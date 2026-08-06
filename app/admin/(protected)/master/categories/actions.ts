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
import { ADMIN_MASTER_OPTION_TAGS } from "@/lib/admin-master-options";
import { AuditAction } from "@/lib/generated/prisma";
import { updateProductSearchCache } from "@/lib/product-search-cache";
import { triggerSearchKeywordRefresh } from "@/lib/search-keyword-index";
import {
  categoryVisualInputSchema,
  saveCategoryVisualSetting,
} from "@/lib/category-visual-settings";
import { slugifyAsciiSegment } from "@/lib/product-slug";
import { requirePermission } from "@/lib/require-auth";
import { normalizeSearchText } from "@/lib/search-normalization";
import { buildUniqueSlug } from "@/lib/slug-helpers";
import { refreshCategoryStorefrontCaches } from "@/lib/storefront-revalidation";
import { invalidateCategoryAliasCache } from "@/lib/category-alias-cache";
import { invalidateTransactionProductOptions } from "@/lib/transaction-options";

const categorySchema = z
  .object({
    name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่").max(100),
  })
  .merge(categoryVisualInputSchema);

const categoryAliasSchema = z.object({
  alias: z.string().trim().min(1, "กรุณากรอก alias").max(120),
  kind: z.enum(["MATCH", "SKIP_CATEGORY"]),
  matchMode: z.enum(["EXACT", "CONTAINS", "TOKEN"]),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  notes: z.string().trim().max(500).optional(),
});

const refreshCategorySearchCaches = async ({
  categoryId,
}: {
  categoryId?: string;
}) => {
  updateTag("storefront:categories");
  updateTag("storefront:products");
  updateTag("storefront-product-filters");
  updateProductSearchCache();
  triggerSearchKeywordRefresh();

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

async function getCategoryAliasAuditSnapshot(id: string) {
  return db.categoryAlias.findUnique({
    where: { id },
    select: {
      id: true,
      categoryId: true,
      alias: true,
      kind: true,
      matchMode: true,
      priority: true,
      isActive: true,
      notes: true,
      source: true,
      reviewStatus: true,
      aiCorrectedTerm: true,
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
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    await refreshCategoryStorefrontCaches(category.id);
    invalidateTransactionProductOptions();
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
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    await refreshCategoryStorefrontCaches(id);
    invalidateTransactionProductOptions();
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
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    await refreshCategoryStorefrontCaches(id);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};

export const createCategoryAlias = async (
  categoryId: string,
  formData: FormData,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!categoryId || categoryId.length > 50 || !/^[a-z0-9]+$/.test(categoryId)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = categoryAliasSchema.safeParse({
    alias: formData.get("alias"),
    kind: formData.get("kind"),
    matchMode: formData.get("matchMode"),
    priority: formData.get("priority"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const requestContext = await getRequestContext();
  const { alias, kind, matchMode, priority, notes } = parsed.data;
  const normalizedNotes = notes?.trim() || null;

  try {
    const category = await db.category.findUnique({
      where: { id: categoryId },
      select: { id: true, name: true, slug: true },
    });
    if (!category) return { error: "ไม่พบหมวดหมู่นี้" };

    const created = await db.categoryAlias.create({
      data: {
        categoryId,
        alias,
        kind,
        matchMode,
        priority,
        notes: normalizedNotes,
      },
    });

    const afterSnapshot = await getCategoryAliasAuditSnapshot(created.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "CategoryAlias",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.alias,
        after: afterSnapshot,
      });
    }

    invalidateCategoryAliasCache();
    revalidatePath("/admin/master/categories");
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    await refreshCategorySearchCaches({ categoryId });
    return {};
  } catch {
    return { error: "ไม่สามารถเพิ่ม alias ได้ กรุณาตรวจสอบว่าคำนี้ซ้ำอยู่แล้วหรือไม่" };
  }
};

export const updateCategoryAlias = async (
  id: string,
  formData: FormData,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = categoryAliasSchema.safeParse({
    alias: formData.get("alias"),
    kind: formData.get("kind"),
    matchMode: formData.get("matchMode"),
    priority: formData.get("priority"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const requestContext = await getRequestContext();
  const { alias, kind, matchMode, priority, notes } = parsed.data;
  const normalizedNotes = notes?.trim() || null;

  try {
    const beforeSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบ alias นี้" };

    await db.categoryAlias.update({
      where: { id },
      data: { alias, kind, matchMode, priority, notes: normalizedNotes },
    });

    const afterSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "CategoryAlias",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.alias,
        before: diff.before,
        after: diff.after,
      });
    }

    invalidateCategoryAliasCache();
    revalidatePath("/admin/master/categories");
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    await refreshCategorySearchCaches({ categoryId: beforeSnapshot.categoryId ?? undefined });
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไข alias ได้ กรุณาตรวจสอบว่าคำนี้ซ้ำอยู่แล้วหรือไม่" };
  }
};

export const toggleCategoryAlias = async (
  id: string,
  isActive: boolean,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const requestContext = await getRequestContext();
  try {
    const beforeSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบ alias นี้" };

    await db.categoryAlias.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "CategoryAlias",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.alias,
        before: diff.before,
        after: diff.after,
      });
    }

    invalidateCategoryAliasCache();
    revalidatePath("/admin/master/categories");
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    await refreshCategorySearchCaches({ categoryId: beforeSnapshot.categoryId ?? undefined });
    return {};
  } catch {
    return { error: "ไม่สามารถเปลี่ยนสถานะ alias ได้" };
  }
};

/**
 * Approve an AI-suggested (PENDING) alias: activate it AND create the paired
 * SearchKeyword synonym (misspelling → corrected term) so storefront/rule search
 * benefit too. The synonym is created ONLY here, on human approval — never by the
 * AI auto-stage step.
 */
export const approveAiCategoryAlias = async (id: string): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const requestContext = await getRequestContext();
  try {
    const beforeSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบรายการนี้" };
    if (beforeSnapshot.reviewStatus !== "PENDING") {
      return { error: "รายการนี้ไม่ได้อยู่ในสถานะรออนุมัติ" };
    }

    await db.categoryAlias.update({
      where: { id },
      data: { isActive: true, reviewStatus: "APPROVED" },
    });

    // Paired SearchKeyword synonym: misspelling → corrected canonical term.
    const correctedTerm = beforeSnapshot.aiCorrectedTerm?.trim();
    if (correctedTerm) {
      const normalized = normalizeSearchText(beforeSnapshot.alias);
      if (normalized) {
        await db.searchKeyword.upsert({
          where: { normalized_kind: { normalized, kind: "synonym" } },
          update: { term: correctedTerm },
          create: { term: correctedTerm, normalized, kind: "synonym", sublabel: correctedTerm },
        });
      }
    }

    const afterSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "CategoryAlias",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.alias,
        before: diff.before,
        after: diff.after,
        meta: { reviewAction: "APPROVE" },
      });
    }

    invalidateCategoryAliasCache();
    triggerSearchKeywordRefresh();
    revalidatePath("/admin/master/categories");
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    await refreshCategorySearchCaches({ categoryId: beforeSnapshot.categoryId ?? undefined });
    return {};
  } catch {
    return { error: "ไม่สามารถอนุมัติรายการนี้ได้" };
  }
};

/**
 * Reject an AI-suggested (PENDING) alias: keep the row (isActive stays false) and
 * mark it REJECTED so the AI never re-suggests the same misspelling.
 */
export const rejectAiCategoryAlias = async (id: string): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const requestContext = await getRequestContext();
  try {
    const beforeSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบรายการนี้" };
    if (beforeSnapshot.reviewStatus !== "PENDING") {
      return { error: "รายการนี้ไม่ได้อยู่ในสถานะรออนุมัติ" };
    }

    await db.categoryAlias.update({
      where: { id },
      data: { isActive: false, reviewStatus: "REJECTED" },
    });

    const afterSnapshot = await getCategoryAliasAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "CategoryAlias",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.alias,
        before: diff.before,
        after: diff.after,
        meta: { reviewAction: "REJECT" },
      });
    }

    invalidateCategoryAliasCache();
    revalidatePath("/admin/master/categories");
    updateTag(ADMIN_MASTER_OPTION_TAGS.categories);
    return {};
  } catch {
    return { error: "ไม่สามารถปฏิเสธรายการนี้ได้" };
  }
};
