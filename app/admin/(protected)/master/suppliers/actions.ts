"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const supplierSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อผู้จำหน่าย"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

export const createSupplier = async (formData: FormData): Promise<{ error?: string }> => {
  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await db.supplier.create({
      data: {
        name: parsed.data.name,
        contactName: parsed.data.contactName ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
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
  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await db.supplier.update({
      where: { id },
      data: {
        name: parsed.data.name,
        contactName: parsed.data.contactName ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
      },
    });
    revalidatePath("/admin/master/suppliers");
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขข้อมูลผู้จำหน่ายได้ ชื่อนี้อาจมีอยู่แล้ว" };
  }
};

export const deleteSupplier = async (id: string): Promise<{ error?: string }> => {
  try {
    await db.supplier.delete({ where: { id } });
    revalidatePath("/admin/master/suppliers");
    return {};
  } catch {
    return { error: "ไม่สามารถลบผู้จำหน่ายนี้ได้ อาจมีใบสั่งซื้อที่เกี่ยวข้องอยู่" };
  }
};
