"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const customerSchema = z.object({
  code:            z.string().max(20).optional(),
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
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = customerSchema.safeParse({
    code:            formData.get("code")            || undefined,
    name:            formData.get("name"),
    phone:           formData.get("phone")           || undefined,
    address:         formData.get("address")         || undefined,
    shippingAddress: formData.get("shippingAddress") || undefined,
    taxId:           formData.get("taxId")           || undefined,
    note:            formData.get("note")            || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { code, name, phone, address, shippingAddress, taxId, note } = parsed.data;

  try {
    const customer = await db.customer.create({
      data: {
        code:            code            ?? null,
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
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = customerSchema.safeParse({
    code:            formData.get("code")            || undefined,
    name:            formData.get("name"),
    phone:           formData.get("phone")           || undefined,
    address:         formData.get("address")         || undefined,
    shippingAddress: formData.get("shippingAddress") || undefined,
    taxId:           formData.get("taxId")           || undefined,
    note:            formData.get("note")            || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { code, name, phone, address, shippingAddress, taxId, note } = parsed.data;

  try {
    await db.customer.update({
      where: { id },
      data: {
        code:            code            ?? null,
        name,
        phone:           phone           ?? null,
        address:         address         ?? null,
        shippingAddress: shippingAddress ?? null,
        taxId:           taxId           ?? null,
        note:            note            ?? null,
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

export async function deleteCustomer(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  try {
    const saleCount = await db.sale.count({ where: { customerId: id } });
    if (saleCount > 0) {
      return { error: "มีประวัติการขายที่เชื่อมอยู่ ไม่สามารถลบได้" };
    }

    await db.customer.delete({ where: { id } });
    revalidatePath("/admin/customers");
    return { success: true };
  } catch (err) {
    console.error("[deleteCustomer]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
