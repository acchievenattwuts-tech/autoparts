"use server";

import { db, dbTx } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/require-auth";
import { generateProductCode } from "@/lib/entity-code";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const productUnitSchema = z.object({
  name: z.string().min(1, "ชื่อหน่วยต้องไม่ว่าง").max(20),
  scale: z.coerce.number().positive("scale ต้องมากกว่า 0").max(999999),
  isBase: z.boolean(),
});

const productSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อสินค้า").max(200),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่").max(50),
  brandId: z.string().max(50).optional(),
  preferredSupplierId: z.string().max(50).optional(),
  shelfLocation: z.string().max(50).optional(),
  costPrice: z.coerce.number().min(0).max(9_999_999).default(0),
  salePrice: z.coerce.number().min(0).max(9_999_999).default(0),
  minStock: z.coerce.number().int().min(0).max(99_999).default(1),
  warrantyDays: z.coerce.number().int().min(0).max(36_500).default(0),
  saleUnitName: z.string().min(1).max(20).default("ชิ้น"),
  purchaseUnitName: z.string().min(1).max(20).default("ชิ้น"),
  reportUnitName: z.string().min(1).max(20).default("ชิ้น"),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().url().max(500).optional().or(z.literal("")),
  // Lot Control (string "true"/"false" from FormData → boolean)
  isLotControl: z.preprocess((v) => v === "true", z.boolean()).default(false),
  requireExpiryDate: z.preprocess((v) => v === "true", z.boolean()).default(false),
  allowExpiredIssue: z.preprocess((v) => v === "true", z.boolean()).default(false),
  lotIssueMethod: z.enum(["FIFO", "FEFO", "MANUAL"]).default("FIFO"),
  aliases: z.array(z.string().max(100)).max(20).default([]),
  carModelIds: z.array(z.string().max(50)).max(100).default([]),
  units: z.array(productUnitSchema).min(1, "ต้องมีหน่วยนับอย่างน้อย 1 หน่วย").max(20),
});

type ProductInput = z.infer<typeof productSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseProductFormData = (
  formData: FormData
): { success: true; data: ProductInput } | { success: false; error: string } => {
  let aliases: string[] = [];
  let carModelIds: string[] = [];
  let units: z.infer<typeof productUnitSchema>[] = [];

  try {
    const raw = formData.get("aliases");
    if (typeof raw === "string" && raw) aliases = JSON.parse(raw) as string[];
  } catch {
    return { success: false, error: "รูปแบบข้อมูล aliases ไม่ถูกต้อง" };
  }

  try {
    const raw = formData.get("carModelIds");
    if (typeof raw === "string" && raw) carModelIds = JSON.parse(raw) as string[];
  } catch {
    return { success: false, error: "รูปแบบข้อมูล carModelIds ไม่ถูกต้อง" };
  }

  try {
    const raw = formData.get("units");
    if (typeof raw === "string" && raw) units = JSON.parse(raw) as typeof units;
  } catch {
    return { success: false, error: "รูปแบบข้อมูลหน่วยนับไม่ถูกต้อง" };
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
    costPrice: formData.get("costPrice"),
    salePrice: formData.get("salePrice"),
    minStock: formData.get("minStock"),
    warrantyDays: formData.get("warrantyDays"),
    saleUnitName,
    purchaseUnitName,
    reportUnitName,
    description: formData.get("description") || undefined,
    imageUrl: formData.get("imageUrl") || undefined,
    isLotControl: formData.get("isLotControl") ?? "false",
    requireExpiryDate: formData.get("requireExpiryDate") ?? "false",
    allowExpiredIssue: formData.get("allowExpiredIssue") ?? "false",
    lotIssueMethod: formData.get("lotIssueMethod") ?? "FIFO",
    aliases,
    carModelIds,
    units,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  return { success: true, data: parsed.data };
};

// ─── Actions ─────────────────────────────────────────────────────────────────

export const createProduct = async (
  formData: FormData
): Promise<{ error?: string }> => {
  try {
    await requirePermission("products.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const result = parseProductFormData(formData);
  if (!result.success) return { error: result.error };

  const { aliases, carModelIds, units, ...productData } = result.data;
  const code = await generateProductCode();

  try {
    await dbTx(async (tx) => {
      const product = await tx.product.create({
        data: {
          code,
          name: productData.name,
          categoryId: productData.categoryId,
          brandId: productData.brandId || null,
          preferredSupplierId: productData.preferredSupplierId || null,
          shelfLocation: productData.shelfLocation,
          costPrice: productData.costPrice,
          salePrice: productData.salePrice,
          minStock: productData.minStock,
          warrantyDays: productData.warrantyDays,
          saleUnitName: productData.saleUnitName,
          purchaseUnitName: productData.purchaseUnitName,
          reportUnitName: productData.reportUnitName,
          description: productData.description,
          imageUrl: productData.imageUrl || null,
          isLotControl: productData.isLotControl,
          requireExpiryDate: productData.requireExpiryDate,
          allowExpiredIssue: productData.allowExpiredIssue,
          lotIssueMethod: productData.lotIssueMethod,
          stock: 0, // stock เริ่มต้น = 0 เสมอ (ใช้ระบบ BF ใน Phase 3)
        },
      });

      await tx.productUnit.createMany({
        data: units.map((u) => ({
          productId: product.id,
          name: u.name,
          scale: u.scale,
          isBase: u.isBase,
        })),
      });

      if (aliases.length > 0) {
        await tx.productAlias.createMany({
          data: aliases.map((alias) => ({ productId: product.id, alias })),
          skipDuplicates: true,
        });
      }

      if (carModelIds.length > 0) {
        await tx.productCarModel.createMany({
          data: carModelIds.map((carModelId) => ({
            productId: product.id,
            carModelId,
          })),
          skipDuplicates: true,
        });
      }
    });

    revalidatePath("/admin/products");
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
  try {
    await requirePermission("products.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสสินค้าไม่ถูกต้อง" };
  }

  const result = parseProductFormData(formData);
  if (!result.success) return { error: result.error };

  const { aliases, carModelIds, units, ...productData } = result.data;

  try {
    await dbTx(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          name: productData.name,
          categoryId: productData.categoryId,
          brandId: productData.brandId || null,
          preferredSupplierId: productData.preferredSupplierId || null,
          shelfLocation: productData.shelfLocation,
          costPrice: productData.costPrice,
          salePrice: productData.salePrice,
          minStock: productData.minStock,
          warrantyDays: productData.warrantyDays,
          saleUnitName: productData.saleUnitName,
          purchaseUnitName: productData.purchaseUnitName,
          reportUnitName: productData.reportUnitName,
          description: productData.description,
          imageUrl: productData.imageUrl || null,
          isLotControl: productData.isLotControl,
          requireExpiryDate: productData.requireExpiryDate,
          allowExpiredIssue: productData.allowExpiredIssue,
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

      // Sync aliases
      await tx.productAlias.deleteMany({ where: { productId: id } });
      if (aliases.length > 0) {
        await tx.productAlias.createMany({
          data: aliases.map((alias) => ({ productId: id, alias })),
          skipDuplicates: true,
        });
      }

      // Sync car models
      await tx.productCarModel.deleteMany({ where: { productId: id } });
      if (carModelIds.length > 0) {
        await tx.productCarModel.createMany({
          data: carModelIds.map((carModelId) => ({
            productId: id,
            carModelId,
          })),
          skipDuplicates: true,
        });
      }
    });

    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${id}/edit`);
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
  try {
    await requirePermission("products.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสสินค้าไม่ถูกต้อง" };
  }

  try {
    await db.product.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/products");
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};

export const uploadProductImage = async (
  formData: FormData
): Promise<{ url?: string; error?: string }> => {
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
    return { error: "อนุญาตเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, GIF)" };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: "ขนาดไฟล์ต้องไม่เกิน 5MB" };
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { error: "นามสกุลไฟล์ไม่ถูกต้อง ใช้ได้: jpg, png, webp, gif" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { error: "ไม่พบการตั้งค่า Supabase" };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const safeFileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const filePath = `products/${safeFileName}`;
    const buffer = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("products")
      .upload(filePath, buffer, { contentType: file.type, upsert: false });

    if (uploadError) return { error: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };

    const { data: { publicUrl } } = supabase.storage.from("products").getPublicUrl(filePath);
    return { url: publicUrl };
  } catch {
    return { error: "เกิดข้อผิดพลาดขณะอัปโหลดรูปภาพ" };
  }
};
