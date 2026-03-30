"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateCustomerCode } from "@/lib/entity-code";

const customerSchema = z.object({
  name:            z.string().min(1, "กรุณาระบุชื่อลูกค้า").max(100),
  phone:           z.string().max(20).optional(),
  address:         z.string().max(300).optional(),
  shippingAddress: z.string().max(500).optional(),
  taxId:           z.string().max(20).optional(),
  note:            z.string().max(500).optional(),
});

export async function createCustomer(
  formData: FormData
): Promise<{ success?: boolean; id?: string; error?: string }> {
  const session = await requireAdmin().catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = customerSchema.safeParse({
    name:            formData.get("name"),
    phone:           formData.get("phone")           || undefined,
    address:         formData.get("address")         || undefined,
    shippingAddress: formData.get("shippingAddress") || undefined,
    taxId:           formData.get("taxId")           || undefined,
    note:            formData.get("note")            || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, phone, address, shippingAddress, taxId, note } = parsed.data;
  const code = await generateCustomerCode();

  try {
    const customer = await db.customer.create({
      data: {
        code,
        name,
        phone:           phone           ?? null,
        address:         address         ?? null,
        shippingAddress: shippingAddress ?? null,
        taxId:           taxId           ?? null,
        note:            note            ?? null,
      },
    });
    revalidatePath("/admin/customers");
    return { success: true, id: customer.id };
  } catch (err) {
    console.error("[createCustomer]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function updateCustomer(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireAdmin().catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = customerSchema.safeParse({
    name:            formData.get("name"),
    phone:           formData.get("phone")           || undefined,
    address:         formData.get("address")         || undefined,
    shippingAddress: formData.get("shippingAddress") || undefined,
    taxId:           formData.get("taxId")           || undefined,
    note:            formData.get("note")            || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, phone, address, shippingAddress, taxId, note } = parsed.data;

  try {
    await db.customer.update({
      where: { id },
      data: {
        name,
        phone:           phone           ?? null,
        address:         address         ?? null,
        shippingAddress: shippingAddress ?? null,
        taxId:           taxId           ?? null,
        note:            note            ?? null,
        isActive:        true,
      },
    });
    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${id}`);
    return { success: true };
  } catch (err) {
    console.error("[updateCustomer]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function toggleCustomer(
  id: string,
  isActive: boolean
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireAdmin().catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  try {
    await db.customer.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/customers");
    return { success: true };
  } catch (err) {
    console.error("[toggleCustomer]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
