"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-auth";
import { generateSupplierCode } from "@/lib/entity-code";
import { normalizeOptionalTaxId, TAX_ID_INVALID_MESSAGE } from "@/lib/tax-id";

const supplierSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อผู้จำหน่าย").max(200),
  contactName: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  taxId: z.string().regex(/^\d{13}$/, TAX_ID_INVALID_MESSAGE).optional(),
});

export const createSupplier = async (formData: FormData): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
    taxId: normalizeOptionalTaxId(formData.get("taxId")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const code = await generateSupplierCode();

  try {
    await db.supplier.create({
      data: {
        code,
        name: parsed.data.name,
        contactName: parsed.data.contactName ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        taxId: parsed.data.taxId ?? null,
      },
    });
    revalidatePath("/admin/master/suppliers");
    return {};
  } catch {
    return { error: "ชื่อผู้จำหน่ายนี้มีอยู่แล้ว" };
  }
};

export const updateSupplier = async (
  id: string,
  formData: FormData
): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.update");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
    taxId: normalizeOptionalTaxId(formData.get("taxId")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db.supplier.update({
      where: { id },
      data: {
        name: parsed.data.name,
        contactName: parsed.data.contactName ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        taxId: parsed.data.taxId ?? null,
        isActive: true,
      },
    });
    revalidatePath("/admin/master/suppliers");
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขข้อมูลผู้จำหน่ายได้ ชื่อนี้อาจมีอยู่แล้ว" };
  }
};

export const toggleSupplier = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  try {
    await requirePermission("master.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    await db.supplier.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/master/suppliers");
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
