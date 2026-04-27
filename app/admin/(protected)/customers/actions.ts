"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { generateCustomerCode } from "@/lib/entity-code";
import { normalizeOptionalTaxId, TAX_ID_INVALID_MESSAGE } from "@/lib/tax-id";

const customerSchema = z.object({
  name:            z.string().min(1, "กรุณาระบุชื่อลูกค้า").max(100),
  phone:           z.string().max(20).optional(),
  address:         z.string().max(300).optional(),
  shippingAddress: z.string().max(500).optional(),
  taxId:           z.string().regex(/^\d{13}$/, TAX_ID_INVALID_MESSAGE).optional(),
  note:            z.string().max(500).optional(),
  creditTerm:      z.coerce.number().int().min(0).max(365).optional(),
});

function toAuditCustomer(customer: {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  shippingAddress: string | null;
  taxId: string | null;
  note: string | null;
  creditTerm: number | null;
  isActive: boolean;
}) {
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    shippingAddress: customer.shippingAddress,
    taxId: customer.taxId,
    note: customer.note,
    creditTerm: customer.creditTerm,
    isActive: customer.isActive,
  };
}

export async function createCustomer(
  formData: FormData
): Promise<{ success?: boolean; id?: string; error?: string }> {
  const session = await requirePermission("customers.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = customerSchema.safeParse({
    name:            formData.get("name"),
    phone:           formData.get("phone")           || undefined,
    address:         formData.get("address")         || undefined,
    shippingAddress: formData.get("shippingAddress") || undefined,
    taxId:           normalizeOptionalTaxId(formData.get("taxId")),
    note:            formData.get("note")            || undefined,
    creditTerm:      formData.get("creditTerm")      || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, phone, address, shippingAddress, taxId, note, creditTerm } = parsed.data;
  const code = await generateCustomerCode();

  try {
    const requestContext = await getRequestContext();
    const customer = await db.customer.create({
      data: {
        code,
        name,
        phone:           phone           ?? null,
        address:         address         ?? null,
        shippingAddress: shippingAddress ?? null,
        taxId:           taxId           ?? null,
        note:            note            ?? null,
        creditTerm:      creditTerm      ?? null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        address: true,
        shippingAddress: true,
        taxId: true,
        note: true,
        creditTerm: true,
        isActive: true,
      },
    });
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "Customer",
      entityId: customer.id,
      entityRef: customer.code ?? customer.name,
      after: toAuditCustomer(customer),
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
  const session = await requirePermission("customers.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = customerSchema.safeParse({
    name:            formData.get("name"),
    phone:           formData.get("phone")           || undefined,
    address:         formData.get("address")         || undefined,
    shippingAddress: formData.get("shippingAddress") || undefined,
    taxId:           normalizeOptionalTaxId(formData.get("taxId")),
    note:            formData.get("note")            || undefined,
    creditTerm:      formData.get("creditTerm")      || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, phone, address, shippingAddress, taxId, note, creditTerm } = parsed.data;

  try {
    const requestContext = await getRequestContext();
    const existingCustomer = await db.customer.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        address: true,
        shippingAddress: true,
        taxId: true,
        note: true,
        creditTerm: true,
        isActive: true,
      },
    });
    if (!existingCustomer) {
      return { error: "Customer not found" };
    }

    const updatedCustomer = await db.customer.update({
      where: { id },
      data: {
        name,
        phone:           phone           ?? null,
        address:         address         ?? null,
        shippingAddress: shippingAddress ?? null,
        taxId:           taxId           ?? null,
        note:            note            ?? null,
        creditTerm:      creditTerm      ?? null,
        isActive:        true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        address: true,
        shippingAddress: true,
        taxId: true,
        note: true,
        creditTerm: true,
        isActive: true,
      },
    });
    const diff = diffEntity(
      toAuditCustomer(existingCustomer),
      toAuditCustomer(updatedCustomer),
    );

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "Customer",
      entityId: updatedCustomer.id,
      entityRef: updatedCustomer.code ?? updatedCustomer.name,
      before: diff.before,
      after: diff.after,
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
  const session = await requirePermission("customers.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  try {
    const requestContext = await getRequestContext();
    const existingCustomer = await db.customer.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        address: true,
        shippingAddress: true,
        taxId: true,
        note: true,
        creditTerm: true,
        isActive: true,
      },
    });
    if (!existingCustomer) {
      return { error: "Customer not found" };
    }

    const updatedCustomer = await db.customer.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        address: true,
        shippingAddress: true,
        taxId: true,
        note: true,
        creditTerm: true,
        isActive: true,
      },
    });
    const diff = diffEntity(
      toAuditCustomer(existingCustomer),
      toAuditCustomer(updatedCustomer),
    );

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: isActive ? AuditAction.UPDATE : AuditAction.CANCEL,
      entityType: "Customer",
      entityId: updatedCustomer.id,
      entityRef: updatedCustomer.code ?? updatedCustomer.name,
      before: diff.before,
      after: diff.after,
      meta: { isActive },
    });
    revalidatePath("/admin/customers");
    return { success: true };
  } catch (err) {
    console.error("[toggleCustomer]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
