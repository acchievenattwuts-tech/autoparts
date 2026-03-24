"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/require-auth";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const productSchema = z.object({
  code: z.string().min(1, "กรุณากรอกรหัสสินค้า").max(50),
  name: z.string().min(1, "กรุณากรอกชื่อสินค้า").max(200),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่").max(50),
  brand: z.string().max(100).optional(),
  shelfLocation: z.string().max(50).optional(),
  costPrice: z.coerce.number().min(0).max(9_999_999).default(0),
  salePrice: z.coerce.number().min(0).max(9_999_999).default(0),
  unit: z.string().max(20).default("ชิ้น"),
  minStock: z.coerce.number().int().min(0).max(99_999).default(1),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().url().max(500).optional().or(z.literal("")),
  stock: z.coerce.number().int().min(0).max(999_999).default(0),
  aliases: z.array(z.string().max(100)).max(20).default([]),
  carModelIds: z.array(z.string().max(50)).max(100).default([]),
});

type ProductInput = z.infer<typeof productSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseProductFormData = (
  formData: FormData
): { success: true; data: ProductInput } | { success: false; error: string } => {
  let aliases: string[] = [];
  let carModelIds: string[] = [];

  try {
    const aliasesRaw = formData.get("aliases");
    if (typeof aliasesRaw === "string" && aliasesRaw) {
      aliases = JSON.parse(aliasesRaw) as string[];
    }
  } catch {
    return { success: false, error: "รูปแบบข้อมูล aliases ไม่ถูกต้อง" };
  }

  try {
    const carModelIdsRaw = formData.get("carModelIds");
    if (typeof carModelIdsRaw === "string" && carModelIdsRaw) {
      carModelIds = JSON.parse(carModelIdsRaw) as string[];
    }
  } catch {
    return { success: false, error: "รูปแบบข้อมูล carModelIds ไม่ถูกต้อง" };
  }

  const parsed = productSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    brand: formData.get("brand") || undefined,
    shelfLocation: formData.get("shelfLocation") || undefined,
    costPrice: formData.get("costPrice"),
    salePrice: formData.get("salePrice"),
    unit: formData.get("unit") || "ชิ้น",
    minStock: formData.get("minStock"),
    description: formData.get("description") || undefined,
    imageUrl: formData.get("imageUrl") || undefined,
    stock: formData.get("stock"),
    aliases,
    carModelIds,
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
    await requireAuth();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const result = parseProductFormData(formData);
  if (!result.success) return { error: result.error };

  const { aliases, carModelIds, stock, ...productData } = result.data;

  try {
    await db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...productData,
          stock,
          costPrice: productData.costPrice,
          salePrice: productData.salePrice,
        },
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

      if (stock > 0) {
        await tx.stockTransaction.create({
          data: {
            productId: product.id,
            type: "ADJUST_IN",
            quantity: stock,
            note: "ยอดเริ่มต้น",
          },
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
    await requireAuth();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  // Validate ID format
  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสสินค้าไม่ถูกต้อง" };
  }

  const result = parseProductFormData(formData);
  if (!result.success) return { error: result.error };

  const { aliases, carModelIds, stock, ...productData } = result.data;

  try {
    await db.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...productData,
          stock,
          costPrice: productData.costPrice,
          salePrice: productData.salePrice,
        },
      });

      await tx.productAlias.deleteMany({ where: { productId: id } });
      if (aliases.length > 0) {
        await tx.productAlias.createMany({
          data: aliases.map((alias) => ({ productId: id, alias })),
          skipDuplicates: true,
        });
      }

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

export const deleteProduct = async (
  id: string
): Promise<{ error?: string }> => {
  try {
    await requireAuth();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสสินค้าไม่ถูกต้อง" };
  }

  try {
    await db.product.delete({ where: { id } });
    revalidatePath("/admin/products");
    return {};
  } catch {
    return { error: "ไม่สามารถลบสินค้านี้ได้ อาจมีรายการที่เกี่ยวข้อง" };
  }
};

export const uploadProductImage = async (
  formData: FormData
): Promise<{ url?: string; error?: string }> => {
  try {
    await requireAuth();
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "กรุณาเลือกไฟล์รูปภาพ" };
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { error: "อนุญาตเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, GIF)" };
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { error: "ขนาดไฟล์ต้องไม่เกิน 5MB" };
  }

  // Validate file extension
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { error: "นามสกุลไฟล์ไม่ถูกต้อง ใช้ได้: jpg, png, webp, gif" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: "ไม่พบการตั้งค่า Supabase" };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Use random UUID + timestamp to prevent filename enumeration
    const safeFileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const filePath = `products/${safeFileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("products")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return { error: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("products").getPublicUrl(filePath);

    return { url: publicUrl };
  } catch {
    return { error: "เกิดข้อผิดพลาดขณะอัปโหลดรูปภาพ" };
  }
};
