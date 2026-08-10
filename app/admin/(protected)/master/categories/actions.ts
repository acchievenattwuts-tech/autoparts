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
import { sniffImageMimeType } from "@/lib/image-upload-validation";
import { buildCategoryImageObjectPath } from "@/lib/product-image-url";
import {
  deleteCategoryImageObjects,
  isOwnedBlobCategoryImageUrl,
  uploadProductsBucketObject,
} from "@/lib/products-bucket-storage";
import { slugifyAsciiSegment } from "@/lib/product-slug";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { normalizeSearchText } from "@/lib/search-normalization";
import { buildUniqueSlug } from "@/lib/slug-helpers";
import { refreshCategoryStorefrontCaches } from "@/lib/storefront-revalidation";
import { invalidateCategoryAliasCache } from "@/lib/category-alias-cache";
import { invalidateTransactionProductOptions } from "@/lib/transaction-options";

/**
 * Empty string means "no image" — the storefront then falls back on its own.
 *
 * Anything else must be a URL this app itself produced: our Blob host, under the
 * category-thumbnail root. `next.config.ts` only lets next/image load the Blob
 * host, so a URL from anywhere else would render as a broken tile on every
 * storefront page rather than an image.
 */
const categoryImageUrlSchema = z
  .string()
  .max(500)
  .refine((value) => value === "" || isOwnedBlobCategoryImageUrl(value), {
    message: "ลิงก์รูปภาพไม่ถูกต้อง",
  })
  .default("");

const categorySchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อหมวดหมู่").max(100),
  imageUrl: categoryImageUrlSchema,
});

const CATEGORY_IMAGE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CATEGORY_IMAGE_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const CATEGORY_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — tiles render at 80px.

/**
 * Uploads a category thumbnail and returns its public URL. The row is only
 * written when the admin saves the form, so an abandoned upload just leaves an
 * orphan object (same behaviour as the shop-logo uploader).
 *
 * Both master.create and master.update are accepted: the same picker sits in the
 * "add category" form, which a create-only staff member is allowed to submit.
 */
export const uploadCategoryImage = async (
  categoryId: string,
  formData: FormData,
): Promise<{ url?: string; error?: string }> => {
  const session = await requireAnyPermission(["master.create", "master.update"]).catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "กรุณาเลือกไฟล์รูปภาพ" };
  }
  if (!CATEGORY_IMAGE_ALLOWED_MIME_TYPES.includes(file.type)) {
    return { error: "อนุญาตเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP)" };
  }
  if (file.size > CATEGORY_IMAGE_MAX_BYTES) {
    return { error: "ขนาดไฟล์ต้องไม่เกิน 2MB" };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!CATEGORY_IMAGE_ALLOWED_EXTENSIONS.includes(extension)) {
    return { error: "นามสกุลไฟล์ไม่ถูกต้อง ใช้ได้: jpg, png, webp" };
  }

  try {
    const body = new Uint8Array(await file.arrayBuffer());
    const detectedType = sniffImageMimeType(body);
    if (!detectedType || !CATEGORY_IMAGE_ALLOWED_MIME_TYPES.includes(detectedType)) {
      return { error: "ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ (JPEG, PNG, WebP)" };
    }

    const url = await uploadProductsBucketObject({
      objectPath: buildCategoryImageObjectPath(categoryId || "new", extension),
      body,
      contentType: detectedType,
    });
    return { url };
  } catch {
    return { error: "เกิดข้อผิดพลาดขณะอัปโหลดรูปภาพ" };
  }
};

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
      imageUrl: true,
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
    imageUrl: formData.get("imageUrl") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, imageUrl } = parsed.data;

  try {
    const existingSlugs = await db.category.findMany({
      select: { slug: true },
    });

    const category = await db.category.create({
      data: {
        name,
        imageUrl: imageUrl || null,
        slug: buildUniqueSlug({
          value: name,
          taken: existingSlugs.flatMap(({ slug }) => (slug ? [slug] : [])),
          fallback: "category",
          slugify: slugifyAsciiSegment,
        }),
      },
    });

    const afterSnapshot = await getCategoryAuditSnapshot(category.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "Category",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.slug ?? afterSnapshot.name,
        after: afterSnapshot,
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
    imageUrl: formData.get("imageUrl") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, imageUrl } = parsed.data;

  try {
    const beforeSnapshot = await getCategoryAuditSnapshot(id);
    if (!beforeSnapshot) {
      return { error: "ไม่พบหมวดหมู่นี้" };
    }

    const nextImageUrl = imageUrl || null;
    await db.category.update({
      where: { id },
      data: { name, imageUrl: nextImageUrl },
    });

    // The previous thumbnail is unreachable the moment the row points elsewhere,
    // so drop it from Blob. Best-effort, and gated to the category image root.
    if (beforeSnapshot.imageUrl && beforeSnapshot.imageUrl !== nextImageUrl) {
      await deleteCategoryImageObjects([beforeSnapshot.imageUrl]);
    }

    const afterSnapshot = await getCategoryAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
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
