"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { generateProductCode } from "@/lib/entity-code";
import { AliasKind, AuditAction, ProductFitmentType } from "@/lib/generated/prisma";
import {
  INVENTORY_TRACKING_NON_TRACKED,
  INVENTORY_TRACKING_TRACKED,
  isInventoryTracked,
} from "@/lib/inventory-tracking";
import {
  partitionProductFitments,
} from "@/lib/product-fitment";
import { buildUniqueSlug } from "@/lib/slug-helpers";
import { slugifyAsciiSegment } from "@/lib/product-slug";
import { updateProductSearchCache } from "@/lib/product-search-cache";
import {
  buildProductImageObjectPath,
  copyProductImageUrlToCodeFolder,
  createProductImageStorageClient,
  deleteProductImageObjects,
  getProductImageStorageConfig,
  getProductImageObjectPathFromPublicUrl,
  getPublicProductImageUrl,
  isAllowedProductImageUrl,
  isProductImageObjectPath,
  isProductImageObjectPathForCode,
} from "@/lib/product-image-storage";
import { revalidateStorefrontCaches } from "@/lib/storefront-revalidation";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

/**
 * Detects the real image type from the file's magic bytes, ignoring the
 * client-declared MIME type / extension (both spoofable). Returns null when the
 * signature does not match a permitted raster image format.
 */
const sniffImageMimeType = (bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null => {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
};

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const productUnitSchema = z.object({
  name: z.string().min(1, "ชื่อหน่วยต้องไม่ว่าง").max(20),
  scale: z.coerce.number().positive("scale ต้องมากกว่า 0").max(999999),
  isBase: z.boolean(),
});

const productImageSchema = z.object({
  url: z
    .string()
    .url()
    .max(500)
    .refine(isAllowedProductImageUrl, "URL รูปภาพไม่ถูกต้อง"),
  alt: z.string().max(200).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isPrimary: z.boolean().default(false),
});

const productFitmentSchema = z.object({
  carModelId: z.string().min(1).max(50),
  submodel: z.string().max(100).nullable().optional(),
  yearStart: z.coerce.number().int().min(1900).max(2200).nullable().optional(),
  yearEnd: z.coerce.number().int().min(1900).max(2200).nullable().optional(),
  engineCode: z.string().max(50).nullable().optional(),
  engineSize: z.string().max(30).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

const productSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อสินค้า").max(200),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่").max(50),
  brandId: z.string().max(50).optional(),
  preferredSupplierId: z.string().max(50).optional(),
  shelfLocation: z.string().max(50).optional(),
  inventoryTracking: z.enum([INVENTORY_TRACKING_TRACKED, INVENTORY_TRACKING_NON_TRACKED]).default(INVENTORY_TRACKING_TRACKED),
  costPrice: z.coerce.number().min(0).max(9_999_999).default(0),
  salePrice: z.coerce.number().min(0).max(9_999_999).default(0),
  minStock: z.coerce.number().int().min(0).max(99_999).default(1),
  warrantyDays: z.coerce.number().int().min(0).max(36_500).default(0),
  saleUnitName: z.string().min(1).max(20).default("ชิ้น"),
  purchaseUnitName: z.string().min(1).max(20).default("ชิ้น"),
  reportUnitName: z.string().min(1).max(20).default("ชิ้น"),
  description: z.string().max(2000).optional(),
  imageUrl: z
    .string()
    .url()
    .max(500)
    .refine(isAllowedProductImageUrl, "URL รูปภาพไม่ถูกต้อง")
    .optional()
    .or(z.literal("")),
  productImages: z.array(productImageSchema).max(12).default([]),
  // Lot Control (string "true"/"false" from FormData → boolean)
  isLotControl: z.preprocess((v) => v === "true", z.boolean()).default(false),
  requireExpiryDate: z.preprocess((v) => v === "true", z.boolean()).default(false),
  allowExpiredIssue: z.preprocess((v) => v === "true", z.boolean()).default(false),
  lotIssueMethod: z.enum(["FIFO", "FEFO", "MANUAL"]).default("FIFO"),
  aliases: z
    .array(
      z.object({
        alias: z.string().min(1).max(100),
        kind: z.nativeEnum(AliasKind).default(AliasKind.ALIAS),
      }),
    )
    .max(100)
    .default([]),
  fitments: z.array(productFitmentSchema).max(500).default([]),
  compatibleFitments: z.array(productFitmentSchema).max(500).default([]),
  units: z.array(productUnitSchema).min(1, "ต้องมีหน่วยนับอย่างน้อย 1 หน่วย").max(20),
});

type ProductInput = z.infer<typeof productSchema>;
type ProductImageInput = z.infer<typeof productImageSchema>;

const revalidateStorefrontProductCaches = async (productId?: string) => {
  revalidatePath("/admin/products");
  updateProductSearchCache();
  if (productId) {
    updateTag(`storefront-product:${productId}`);
  }
  await revalidateStorefrontCaches();
};

const getStringFormValue = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
};

const normalizeRequestedProductCode = (value: string): string | null => {
  const code = value.trim().toUpperCase();
  return /^P\d{4,}$/.test(code) ? code : null;
};

async function resolveCreateProductCode(formData: FormData): Promise<string> {
  const requestedCode = normalizeRequestedProductCode(getStringFormValue(formData, "imageUploadCode"));
  if (requestedCode) {
    const existing = await db.product.findUnique({
      where: { code: requestedCode },
      select: { id: true },
    });
    if (!existing) {
      return requestedCode;
    }
  }

  return generateProductCode();
}

async function normalizeProductImagesForCode(
  productImages: ProductImageInput[],
  productCode: string,
): Promise<{ productImages: ProductImageInput[]; orphanedSourceUrls: string[]; error?: string }> {
  if (productImages.length === 0) {
    return { productImages, orphanedSourceUrls: [] };
  }

  const needsStorageCopy = productImages.some((image) => {
    const objectPath = getProductImageObjectPathFromPublicUrl(image.url);
    return objectPath && isProductImageObjectPath(objectPath) && !isProductImageObjectPathForCode(objectPath, productCode);
  });

  if (!needsStorageCopy) {
    return { productImages, orphanedSourceUrls: [] };
  }

  const config = getProductImageStorageConfig();
  if (!config) {
    return { productImages, orphanedSourceUrls: [], error: "ไม่พบการตั้งค่า Supabase" };
  }

  const client = createProductImageStorageClient(config);
  const copiedUrls = new Map<string, string>();
  const nextImages: ProductImageInput[] = [];
  // Source temp-upload URLs that were copied into the code folder and are now
  // unreferenced — caller must delete them after a successful DB commit.
  const orphanedSources = new Set<string>();

  for (const image of productImages) {
    const cachedUrl = copiedUrls.get(image.url);
    if (cachedUrl) {
      nextImages.push({ ...image, url: cachedUrl });
      continue;
    }

    const result = await copyProductImageUrlToCodeFolder({
      client,
      url: image.url,
      productCode,
    });

    if (!result.success) {
      return { productImages, orphanedSourceUrls: [], error: "ย้ายรูปสินค้าเข้าโฟลเดอร์ตามรหัสสินค้าไม่สำเร็จ" };
    }

    if (result.copied) {
      orphanedSources.add(image.url);
    }
    copiedUrls.set(image.url, result.url);
    nextImages.push({ ...image, url: result.url });
  }

  return { productImages: nextImages, orphanedSourceUrls: [...orphanedSources] };
}

/**
 * Best-effort deletion of orphaned storage objects after a product mutation.
 * Skips any URL still referenced by a Product.imageUrl or ProductImage.url so
 * in-use files are never removed. Never throws — cleanup failures must not fail
 * the surrounding mutation.
 */
async function cleanupProductImageObjects(urls: string[]): Promise<void> {
  const unique = [...new Set(urls.filter((url) => url && isAllowedProductImageUrl(url)))];
  if (unique.length === 0) return;

  try {
    const [imageRefs, productRefs] = await Promise.all([
      db.productImage.findMany({ where: { url: { in: unique } }, select: { url: true } }),
      db.product.findMany({ where: { imageUrl: { in: unique } }, select: { imageUrl: true } }),
    ]);

    const referenced = new Set<string>([
      ...imageRefs.map((row) => row.url),
      ...productRefs.flatMap((row) => (row.imageUrl ? [row.imageUrl] : [])),
    ]);

    const deletable = unique.filter((url) => !referenced.has(url));
    if (deletable.length === 0) return;

    const config = getProductImageStorageConfig();
    if (!config) return;

    const client = createProductImageStorageClient(config);
    await deleteProductImageObjects(client, deletable);
  } catch {
    // Best-effort: leaked objects can be reclaimed later; never block the mutation.
  }
}

async function getProductAuditSnapshot(productId: string) {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: {
      aliases: {
        select: { alias: true, kind: true },
        orderBy: [{ kind: "asc" }, { alias: "asc" }],
      },
      units: {
        select: { name: true, scale: true, isBase: true },
        orderBy: [{ isBase: "desc" }, { scale: "asc" }, { name: "asc" }],
      },
      images: {
        select: { url: true, alt: true, sortOrder: true, isPrimary: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      carModels: {
        select: {
          id: true,
          fitmentType: true,
          carModelId: true,
          submodel: true,
          yearStart: true,
          yearEnd: true,
          engineCode: true,
          engineSize: true,
          note: true,
        },
        orderBy: [{ fitmentType: "asc" }, { carModelId: "asc" }, { yearStart: "asc" }],
      },
    },
  });

  if (!product) {
    return null;
  }

  const fitmentSnapshotRows = product.carModels.map((item) => ({
    fitmentType: item.fitmentType,
    carModelId: item.carModelId,
    submodel: item.submodel,
    yearStart: item.yearStart,
    yearEnd: item.yearEnd,
    engineCode: item.engineCode,
    engineSize: item.engineSize,
    note: item.note,
  }));
  const fitmentGroups = partitionProductFitments(fitmentSnapshotRows);

  return {
    id: product.id,
    code: product.code,
    slug: product.slug,
    name: product.name,
    categoryId: product.categoryId,
    brandId: product.brandId,
    preferredSupplierId: product.preferredSupplierId,
    shelfLocation: product.shelfLocation,
    inventoryTracking: product.inventoryTracking,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    minStock: product.minStock,
    warrantyDays: product.warrantyDays,
    saleUnitName: product.saleUnitName,
    purchaseUnitName: product.purchaseUnitName,
    reportUnitName: product.reportUnitName,
    description: product.description,
    imageUrl: product.imageUrl,
    productImages: product.images,
    isLotControl: product.isLotControl,
    requireExpiryDate: product.requireExpiryDate,
    allowExpiredIssue: product.allowExpiredIssue,
    lotIssueMethod: product.lotIssueMethod,
    isActive: product.isActive,
    aliases: product.aliases.map((item) => ({ alias: item.alias, kind: item.kind })),
    fitments: fitmentGroups.direct.map((item) => ({
      carModelId: item.carModelId,
      submodel: item.submodel,
      yearStart: item.yearStart,
      yearEnd: item.yearEnd,
      engineCode: item.engineCode,
      engineSize: item.engineSize,
      note: item.note,
    })),
    compatibleFitments: fitmentGroups.compatible.map((item) => ({
      carModelId: item.carModelId,
      submodel: item.submodel,
      yearStart: item.yearStart,
      yearEnd: item.yearEnd,
      engineCode: item.engineCode,
      engineSize: item.engineSize,
      note: item.note,
    })),
    units: product.units,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseFitmentRowsJson = (raw: string): ProductInput["fitments"] => {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => {
      if (typeof item === "string") {
        return { carModelId: item };
      }
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        return {
          carModelId: String(rec.carModelId ?? ""),
          submodel: typeof rec.submodel === "string" && rec.submodel.trim() !== "" ? rec.submodel : null,
          yearStart:
            rec.yearStart === null || rec.yearStart === undefined || rec.yearStart === ""
              ? null
              : Number(rec.yearStart),
          yearEnd:
            rec.yearEnd === null || rec.yearEnd === undefined || rec.yearEnd === ""
              ? null
              : Number(rec.yearEnd),
          engineCode:
            typeof rec.engineCode === "string" && rec.engineCode.trim() !== ""
              ? rec.engineCode
              : null,
          engineSize:
            typeof rec.engineSize === "string" && rec.engineSize.trim() !== ""
              ? rec.engineSize
              : null,
          note: typeof rec.note === "string" && rec.note.trim() !== "" ? rec.note : null,
        };
      }
      return { carModelId: "" };
    })
    .filter((fitment) => fitment.carModelId);
};

const parseProductFormData = (
  formData: FormData
): { success: true; data: ProductInput } | { success: false; error: string } => {
  let aliases: ProductInput["aliases"] = [];
  let fitments: ProductInput["fitments"] = [];
  let compatibleFitments: ProductInput["compatibleFitments"] = [];
  let units: z.infer<typeof productUnitSchema>[] = [];
  let productImages: z.infer<typeof productImageSchema>[] = [];

  try {
    const raw = formData.get("aliases");
    if (typeof raw === "string" && raw) {
      const parsedAliases = JSON.parse(raw) as unknown;
      if (Array.isArray(parsedAliases)) {
        // Backward-compat: accept legacy string[] form
        aliases = parsedAliases.map((item) => {
          if (typeof item === "string") {
            return { alias: item, kind: AliasKind.ALIAS };
          }
          if (item && typeof item === "object" && "alias" in item) {
            const rec = item as { alias: unknown; kind?: unknown };
            const kindCandidate = typeof rec.kind === "string" ? rec.kind : AliasKind.ALIAS;
            const kind = (Object.values(AliasKind) as string[]).includes(kindCandidate)
              ? (kindCandidate as AliasKind)
              : AliasKind.ALIAS;
            return { alias: String(rec.alias ?? ""), kind };
          }
          return { alias: "", kind: AliasKind.ALIAS };
        });
      }
    }
  } catch {
    return { success: false, error: "รูปแบบข้อมูล aliases ไม่ถูกต้อง" };
  }

  try {
    const raw = formData.get("fitments");
    if (typeof raw === "string" && raw) {
      fitments = parseFitmentRowsJson(raw);
    }

    const rawCompatible = formData.get("compatibleFitments");
    if (typeof rawCompatible === "string" && rawCompatible) {
      compatibleFitments = parseFitmentRowsJson(rawCompatible);
    }
  } catch {
    return { success: false, error: "รูปแบบข้อมูลรุ่นรถ/ปีไม่ถูกต้อง" };
  }

  // Legacy fallback: old carModelIds payload (Phase B and earlier)
  if (fitments.length === 0) {
    try {
      const raw = formData.get("carModelIds");
      if (typeof raw === "string" && raw) {
        const ids = JSON.parse(raw) as string[];
        if (Array.isArray(ids)) {
          fitments = ids.filter((s) => typeof s === "string" && s).map((id) => ({ carModelId: id }));
        }
      }
    } catch {
      // ignore — fitments stays empty
    }
  }

  try {
    const raw = formData.get("units");
    if (typeof raw === "string" && raw) units = JSON.parse(raw) as typeof units;
  } catch {
    return { success: false, error: "รูปแบบข้อมูลหน่วยนับไม่ถูกต้อง" };
  }

  try {
    const raw = formData.get("productImages");
    if (typeof raw === "string" && raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        productImages = parsed
          .map((item, index) => {
            const rec = item as { url?: unknown; alt?: unknown; sortOrder?: unknown; isPrimary?: unknown };
            return {
              url: String(rec.url ?? ""),
              alt: typeof rec.alt === "string" ? rec.alt : null,
              sortOrder: Number.isFinite(Number(rec.sortOrder)) ? Number(rec.sortOrder) : index,
              isPrimary: rec.isPrimary === true,
            };
          })
          .filter((item) => item.url.trim() !== "");
      }
    }
  } catch {
    return { success: false, error: "รูปแบบข้อมูลรูปภาพสินค้าไม่ถูกต้อง" };
  }

  if (productImages.length > 0 && !productImages.some((image) => image.isPrimary)) {
    productImages = productImages.map((image, index) => ({ ...image, isPrimary: index === 0 }));
  }

  // Validate: exactly one base unit with scale = 1
  const baseUnits = units.filter((u) => u.isBase);
  if (baseUnits.length !== 1) {
    return { success: false, error: "ต้องมีหน่วยหลักหนึ่งหน่วย (scale = 1)" };
  }
  if (baseUnits[0].scale !== 1) {
    return { success: false, error: "หน่วยหลักต้องมี scale = 1 เสมอ" };
  }

  // Validate unit names are unique
  const names = units.map((u) => u.name);
  if (new Set(names).size !== names.length) {
    return { success: false, error: "ชื่อหน่วยนับต้องไม่ซ้ำกัน" };
  }

  const saleUnitName = formData.get("saleUnitName") as string;
  const purchaseUnitName = formData.get("purchaseUnitName") as string;
  const reportUnitName = formData.get("reportUnitName") as string;

  // Validate unit names exist in units list
  if (!names.includes(saleUnitName))
    return { success: false, error: "หน่วยขายไม่พบในรายการหน่วยนับ" };
  if (!names.includes(purchaseUnitName))
    return { success: false, error: "หน่วยซื้อไม่พบในรายการหน่วยนับ" };
  if (!names.includes(reportUnitName))
    return { success: false, error: "หน่วยรายงานไม่พบในรายการหน่วยนับ" };

  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    brandId: formData.get("brandId") || undefined,
    preferredSupplierId: formData.get("preferredSupplierId") || undefined,
    shelfLocation: formData.get("shelfLocation") || undefined,
    inventoryTracking: formData.get("inventoryTracking") || INVENTORY_TRACKING_TRACKED,
    costPrice: formData.get("costPrice"),
    salePrice: formData.get("salePrice"),
    minStock: formData.get("minStock"),
    warrantyDays: formData.get("warrantyDays"),
    saleUnitName,
    purchaseUnitName,
    reportUnitName,
    description: formData.get("description") || undefined,
    imageUrl: formData.get("imageUrl") || undefined,
    productImages,
    isLotControl: formData.get("isLotControl") ?? "false",
    requireExpiryDate: formData.get("requireExpiryDate") ?? "false",
    allowExpiredIssue: formData.get("allowExpiredIssue") ?? "false",
    lotIssueMethod: formData.get("lotIssueMethod") ?? "FIFO",
    aliases,
    fitments,
    compatibleFitments,
    units,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  return { success: true, data: parsed.data };
};

async function assertCanSetInventoryTracking(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  productId: string,
  nextInventoryTracking: ProductInput["inventoryTracking"],
): Promise<void> {
  if (isInventoryTracked(nextInventoryTracking)) return;

  const currentProduct = await tx.product.findUnique({
    where: { id: productId },
    select: { inventoryTracking: true, stock: true },
  });
  if (!currentProduct) throw new Error("ไม่พบสินค้า");
  if (!isInventoryTracked(currentProduct.inventoryTracking)) return;

  const stockCardCount = await tx.stockCard.count({ where: { productId } });
  if (stockCardCount === 0) return;

  if (currentProduct.stock !== 0) {
    throw new Error("สินค้านี้มีประวัติสต็อกและยอดคงเหลือยังไม่เป็นศูนย์ กรุณาปรับยอดให้เป็นศูนย์หรือสร้างรหัสสินค้าใหม่");
  }

  const openLot = await tx.lotBalance.findFirst({
    where: { productId, qtyOnHand: { not: 0 } },
    select: { id: true },
  });
  if (openLot) {
    throw new Error("สินค้านี้มี Lot คงเหลือ กรุณาปรับ Lot ให้เป็นศูนย์ก่อนเปลี่ยนเป็นไม่คำนวณสต็อก");
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const buildProductFitmentCreateManyData = (
  productId: string,
  fitments: ProductInput["fitments"],
  compatibleFitments: ProductInput["compatibleFitments"],
) => [
  ...fitments.map((fitment) => ({
    productId,
    fitmentType: ProductFitmentType.DIRECT,
    carModelId: fitment.carModelId,
    submodel: fitment.submodel ?? null,
    yearStart: fitment.yearStart ?? null,
    yearEnd: fitment.yearEnd ?? null,
    engineCode: fitment.engineCode ?? null,
    engineSize: fitment.engineSize ?? null,
    note: fitment.note ?? null,
  })),
  ...compatibleFitments.map((fitment) => ({
    productId,
    fitmentType: ProductFitmentType.COMPATIBLE,
    carModelId: fitment.carModelId,
    submodel: fitment.submodel ?? null,
    yearStart: fitment.yearStart ?? null,
    yearEnd: fitment.yearEnd ?? null,
    engineCode: fitment.engineCode ?? null,
    engineSize: fitment.engineSize ?? null,
    note: fitment.note ?? null,
  })),
];

export const createProduct = async (
  formData: FormData
): Promise<{ error?: string }> => {
  let session;
  try {
    session = await requirePermission("products.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const result = parseProductFormData(formData);
  if (!result.success) return { error: result.error };

  const { aliases, fitments, compatibleFitments, units, productImages: parsedProductImages, ...productData } =
    result.data;
  const code = await resolveCreateProductCode(formData);
  const normalizedImages = await normalizeProductImagesForCode(parsedProductImages, code);
  if (normalizedImages.error) return { error: normalizedImages.error };
  const productImages = normalizedImages.productImages;
  const primaryImageUrl =
    productImages.find((image) => image.isPrimary)?.url ?? productImages[0]?.url ?? productData.imageUrl;
  let createdProductId = "";

  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      const existingSlugs = await tx.product.findMany({
        select: { slug: true },
      });

      const product = await tx.product.create({
        data: {
          code,
          slug: buildUniqueSlug({
            value: productData.name,
            taken: existingSlugs.flatMap(({ slug }) => (slug ? [slug] : [])),
            fallback: code.toLowerCase(),
            extraCandidates: [code],
            slugify: slugifyAsciiSegment,
          }),
          name: productData.name,
          categoryId: productData.categoryId,
          brandId: productData.brandId || null,
          preferredSupplierId: productData.preferredSupplierId || null,
          shelfLocation: productData.shelfLocation,
          inventoryTracking: productData.inventoryTracking,
          costPrice: productData.costPrice,
          salePrice: productData.salePrice,
          minStock: productData.minStock,
          warrantyDays: productData.warrantyDays,
          saleUnitName: productData.saleUnitName,
          purchaseUnitName: productData.purchaseUnitName,
          reportUnitName: productData.reportUnitName,
          description: productData.description,
          imageUrl: primaryImageUrl || null,
          isLotControl: isInventoryTracked(productData.inventoryTracking) ? productData.isLotControl : false,
          requireExpiryDate: isInventoryTracked(productData.inventoryTracking) ? productData.requireExpiryDate : false,
          allowExpiredIssue: isInventoryTracked(productData.inventoryTracking) ? productData.allowExpiredIssue : false,
          lotIssueMethod: productData.lotIssueMethod,
          stock: 0, // stock เริ่มต้น = 0 เสมอ (ใช้ระบบ BF ใน Phase 3)
        },
      });

      createdProductId = product.id;

      await tx.productUnit.createMany({
        data: units.map((u) => ({
          productId: product.id,
          name: u.name,
          scale: u.scale,
          isBase: u.isBase,
        })),
      });

      if (productImages.length > 0) {
        await tx.productImage.createMany({
          data: productImages.map((image, index) => ({
            productId: product.id,
            url: image.url,
            alt: image.alt || productData.name,
            sortOrder: index,
            isPrimary: image.url === primaryImageUrl,
          })),
        });
      }

      if (aliases.length > 0) {
        await tx.productAlias.createMany({
          data: aliases
            .filter((a) => a.alias.trim() !== "")
            .map(({ alias, kind }) => ({ productId: product.id, alias, kind })),
          skipDuplicates: true,
        });
      }

      if (fitments.length > 0 || compatibleFitments.length > 0) {
        await tx.productFitment.createMany({
          data: buildProductFitmentCreateManyData(product.id, fitments, compatibleFitments),
          skipDuplicates: true,
        });
      }
    });

    const createdSnapshot = createdProductId
      ? await getProductAuditSnapshot(createdProductId)
      : null;

    if (createdSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "Product",
        entityId: createdSnapshot.id,
        entityRef: createdSnapshot.code,
        after: createdSnapshot,
      });
    }

    await cleanupProductImageObjects(normalizedImages.orphanedSourceUrls);
    await revalidateStorefrontProductCaches(createdProductId);
    return {};
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "รหัสสินค้านี้มีอยู่แล้ว" };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
};

export const updateProduct = async (
  id: string,
  formData: FormData
): Promise<{ error?: string }> => {
  let session;
  try {
    session = await requirePermission("products.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสสินค้าไม่ถูกต้อง" };
  }

  const result = parseProductFormData(formData);
  if (!result.success) return { error: result.error };

  const { aliases, fitments, compatibleFitments, units, productImages: parsedProductImages, ...productData } =
    result.data;
  const [currentProductForImages, existingProductImages] = await Promise.all([
    db.product.findUnique({
      where: { id },
      select: { code: true, imageUrl: true },
    }),
    db.productImage.findMany({ where: { productId: id }, select: { url: true } }),
  ]);
  if (!currentProductForImages) {
    return { error: "ไม่พบสินค้า" };
  }
  const previousImageUrls = [
    ...existingProductImages.map((image) => image.url),
    ...(currentProductForImages.imageUrl ? [currentProductForImages.imageUrl] : []),
  ];
  const normalizedImages = await normalizeProductImagesForCode(parsedProductImages, currentProductForImages.code);
  if (normalizedImages.error) return { error: normalizedImages.error };
  const productImages = normalizedImages.productImages;
  const primaryImageUrl =
    productImages.find((image) => image.isPrimary)?.url ?? productImages[0]?.url ?? productData.imageUrl;
  const finalImageUrls = new Set<string>([
    ...productImages.map((image) => image.url),
    ...(primaryImageUrl ? [primaryImageUrl] : []),
  ]);
  const removedImageUrls = previousImageUrls.filter((url) => !finalImageUrls.has(url));

  if (!isInventoryTracked(productData.inventoryTracking)) {
    const currentProduct = await db.product.findUnique({
      where: { id },
      select: { inventoryTracking: true, stock: true },
    });
    if (currentProduct && isInventoryTracked(currentProduct.inventoryTracking)) {
      const stockCardCount = await db.stockCard.count({ where: { productId: id } });
      if (stockCardCount > 0 && currentProduct.stock !== 0) {
        return { error: "สินค้านี้มีประวัติสต็อกและยอดคงเหลือยังไม่เป็นศูนย์ กรุณาปรับยอดให้เป็นศูนย์หรือสร้างรหัสสินค้าใหม่" };
      }
      if (stockCardCount > 0) {
        const openLot = await db.lotBalance.findFirst({
          where: { productId: id, qtyOnHand: { not: 0 } },
          select: { id: true },
        });
        if (openLot) {
          return { error: "สินค้านี้มี Lot คงเหลือ กรุณาปรับ Lot ให้เป็นศูนย์ก่อนเปลี่ยนเป็นไม่คำนวณสต็อก" };
        }
      }
    }
  }

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getProductAuditSnapshot(id);

    await dbTx(async (tx) => {
      const currentProduct = await tx.product.findUnique({
        where: { id },
        select: { slug: true, code: true },
      });

      await assertCanSetInventoryTracking(tx, id, productData.inventoryTracking);

      const existingSlugIsAscii =
        !!currentProduct?.slug && /^[a-z0-9-]+$/.test(currentProduct.slug);
      const fallbackSlug = (currentProduct?.code ?? "").toLowerCase() || "product";
      const slug = existingSlugIsAscii
        ? currentProduct!.slug!
        : buildUniqueSlug({
            value: productData.name,
            taken: (
              await tx.product.findMany({
                where: { NOT: { id } },
                select: { slug: true },
              })
            ).flatMap(({ slug: existingSlug }) => (existingSlug ? [existingSlug] : [])),
            fallback: fallbackSlug,
            extraCandidates: [currentProduct?.code ?? ""],
            slugify: slugifyAsciiSegment,
          });

      await tx.product.update({
        where: { id },
        data: {
          slug,
          name: productData.name,
          categoryId: productData.categoryId,
          brandId: productData.brandId || null,
          preferredSupplierId: productData.preferredSupplierId || null,
          shelfLocation: productData.shelfLocation,
          inventoryTracking: productData.inventoryTracking,
          costPrice: productData.costPrice,
          salePrice: productData.salePrice,
          minStock: productData.minStock,
          warrantyDays: productData.warrantyDays,
          saleUnitName: productData.saleUnitName,
          purchaseUnitName: productData.purchaseUnitName,
          reportUnitName: productData.reportUnitName,
          description: productData.description,
          imageUrl: primaryImageUrl || null,
          isLotControl: isInventoryTracked(productData.inventoryTracking) ? productData.isLotControl : false,
          requireExpiryDate: isInventoryTracked(productData.inventoryTracking) ? productData.requireExpiryDate : false,
          allowExpiredIssue: isInventoryTracked(productData.inventoryTracking) ? productData.allowExpiredIssue : false,
          lotIssueMethod: productData.lotIssueMethod,
          isActive: true,
        },
      });

      // Sync units — delete all and recreate
      await tx.productUnit.deleteMany({ where: { productId: id } });
      await tx.productUnit.createMany({
        data: units.map((u) => ({
          productId: id,
          name: u.name,
          scale: u.scale,
          isBase: u.isBase,
        })),
      });

      await tx.productImage.deleteMany({ where: { productId: id } });
      if (productImages.length > 0) {
        await tx.productImage.createMany({
          data: productImages.map((image, index) => ({
            productId: id,
            url: image.url,
            alt: image.alt || productData.name,
            sortOrder: index,
            isPrimary: image.url === primaryImageUrl,
          })),
        });
      }

      // Sync aliases (delete-and-recreate with kind)
      await tx.productAlias.deleteMany({ where: { productId: id } });
      if (aliases.length > 0) {
        await tx.productAlias.createMany({
          data: aliases
            .filter((a) => a.alias.trim() !== "")
            .map(({ alias, kind }) => ({ productId: id, alias, kind })),
          skipDuplicates: true,
        });
      }

      // Sync fitments (delete-and-recreate)
      await tx.productFitment.deleteMany({ where: { productId: id } });
      if (fitments.length > 0 || compatibleFitments.length > 0) {
        await tx.productFitment.createMany({
          data: buildProductFitmentCreateManyData(id, fitments, compatibleFitments),
          skipDuplicates: true,
        });
      }
    });

    const afterSnapshot = await getProductAuditSnapshot(id);

    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);

      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Product",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.code,
        before: diff.before,
        after: diff.after,
      });
    }

    await cleanupProductImageObjects([...removedImageUrls, ...normalizedImages.orphanedSourceUrls]);
    revalidatePath(`/admin/products/${id}/edit`);
    await revalidateStorefrontProductCaches(id);
    return {};
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "รหัสสินค้านี้มีอยู่แล้ว" };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
};

export const toggleProduct = async (
  id: string,
  isActive: boolean
): Promise<{ error?: string }> => {
  let session;
  try {
    session = await requirePermission("products.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสสินค้าไม่ถูกต้อง" };
  }

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getProductAuditSnapshot(id);

    await db.product.update({ where: { id }, data: { isActive } });

    const afterSnapshot = await getProductAuditSnapshot(id);

    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);

      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: isActive ? AuditAction.UPDATE : AuditAction.CANCEL,
        entityType: "Product",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.code,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }

    await revalidateStorefrontProductCaches(id);
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};

export const uploadProductImage = async (
  formData: FormData
): Promise<{ url?: string; uploadCode?: string; error?: string }> => {
  try {
    await requirePermission("products.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "กรุณาเลือกไฟล์รูปภาพ" };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { error: "อนุญาตเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP)" };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: "ขนาดไฟล์ต้องไม่เกิน 3MB" };
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { error: "นามสกุลไฟล์ไม่ถูกต้อง ใช้ได้: jpg, png, webp" };
  }

  const config = getProductImageStorageConfig();
  if (!config) {
    return { error: "ไม่พบการตั้งค่า Supabase" };
  }

  try {
    const supabase = createProductImageStorageClient(config);
    const requestedCode = normalizeRequestedProductCode(getStringFormValue(formData, "productCode"));
    const buffer = new Uint8Array(await file.arrayBuffer());

    // Verify the actual file content — never trust the client-declared MIME/extension.
    const detectedType = sniffImageMimeType(buffer);
    if (!detectedType) {
      return { error: "ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ (JPEG, PNG, WebP)" };
    }

    const uploadCode = requestedCode ?? await generateProductCode();
    const filePath = buildProductImageObjectPath(uploadCode, ext);

    const { error: uploadError } = await supabase.storage
      .from("products")
      .upload(filePath, buffer, { contentType: detectedType, upsert: false });

    if (uploadError) return { error: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

    return { url: getPublicProductImageUrl(supabase, filePath), uploadCode };
  } catch {
    return { error: "เกิดข้อผิดพลาดขณะอัปโหลดรูปภาพ" };
  }
};
