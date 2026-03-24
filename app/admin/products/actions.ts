"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const productSchema = z.object({
  code: z.string().min(1, "กรุณากรอกรหัสสินค้า"),
  name: z.string().min(1, "กรุณากรอกชื่อสินค้า"),
  categoryId: z.string().min(1, "กรุณาเลือกหมวดหมู่"),
  brand: z.string().optional(),
  shelfLocation: z.string().optional(),
  costPrice: z.coerce.number().min(0).default(0),
  salePrice: z.coerce.number().min(0).default(0),
  unit: z.string().default("ชิ้น"),
  minStock: z.coerce.number().int().min(0).default(1),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  stock: z.coerce.number().int().min(0).default(0),
  aliases: z.array(z.string()).default([]),
  carModelIds: z.array(z.string()).default([]),
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
    if (
      err instanceof Error &&
      err.message.includes("Unique constraint")
    ) {
      return { error: "รหัสสินค้านี้มีอยู่แล้ว" };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
};

export const updateProduct = async (
  id: string,
  formData: FormData
): Promise<{ error?: string }> => {
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
    if (
      err instanceof Error &&
      err.message.includes("Unique constraint")
    ) {
      return { error: "รหัสสินค้านี้มีอยู่แล้ว" };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
};

export const deleteProduct = async (
  id: string
): Promise<{ error?: string }> => {
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
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "กรุณาเลือกไฟล์รูปภาพ" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: "ไม่พบการตั้งค่า Supabase" };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
    const filePath = `products/${fileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("products")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return { error: `อัปโหลดไม่สำเร็จ: ${uploadError.message}` };
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("products").getPublicUrl(filePath);

    return { url: publicUrl };
  } catch {
    return { error: "เกิดข้อผิดพลาดขณะอัปโหลดรูปภาพ" };
  }
};
