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
import { generateSupplierCode } from "@/lib/entity-code";
import { normalizeOptionalTaxId, TAX_ID_INVALID_MESSAGE } from "@/lib/tax-id";

const supplierSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อผู้จำหน่าย").max(200),
  contactName: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  taxId: z.string().regex(/^\d{13}$/, TAX_ID_INVALID_MESSAGE).optional(),
  creditTerm: z.coerce.number().int().min(0).max(365).optional(),
});

function toAuditSupplier(supplier: {
  id: string;
  code: string | null;
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  creditTerm: number | null;
  isActive: boolean;
}) {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    contactName: supplier.contactName,
    phone: supplier.phone,
    address: supplier.address,
    taxId: supplier.taxId,
    creditTerm: supplier.creditTerm,
    isActive: supplier.isActive,
  };
}

export const createSupplier = async (formData: FormData): Promise<{ error?: string }> => {
  let session;
  try {
    session = await requirePermission("master.create");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
    taxId: normalizeOptionalTaxId(formData.get("taxId")),
    creditTerm: formData.get("creditTerm") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const code = await generateSupplierCode();

  try {
    const requestContext = await getRequestContext();
    const supplier = await db.supplier.create({
      data: {
        code,
        name: parsed.data.name,
        contactName: parsed.data.contactName ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        taxId: parsed.data.taxId ?? null,
        creditTerm: parsed.data.creditTerm ?? null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        contactName: true,
        phone: true,
        address: true,
        taxId: true,
        creditTerm: true,
        isActive: true,
      },
    });
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "Supplier",
      entityId: supplier.id,
      entityRef: supplier.code ?? supplier.name,
      after: toAuditSupplier(supplier),
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
  let session;
  try {
    session = await requirePermission("master.update");
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
    creditTerm: formData.get("creditTerm") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const requestContext = await getRequestContext();
    const existingSupplier = await db.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        contactName: true,
        phone: true,
        address: true,
        taxId: true,
        creditTerm: true,
        isActive: true,
      },
    });
    if (!existingSupplier) {
      return { error: "Supplier not found" };
    }

    const updatedSupplier = await db.supplier.update({
      where: { id },
      data: {
        name: parsed.data.name,
        contactName: parsed.data.contactName ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        taxId: parsed.data.taxId ?? null,
        creditTerm: parsed.data.creditTerm ?? null,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        contactName: true,
        phone: true,
        address: true,
        taxId: true,
        creditTerm: true,
        isActive: true,
      },
    });
    const diff = diffEntity(
      toAuditSupplier(existingSupplier),
      toAuditSupplier(updatedSupplier),
    );

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "Supplier",
      entityId: updatedSupplier.id,
      entityRef: updatedSupplier.code ?? updatedSupplier.name,
      before: diff.before,
      after: diff.after,
    });
    revalidatePath("/admin/master/suppliers");
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขข้อมูลผู้จำหน่ายได้ ชื่อนี้อาจมีอยู่แล้ว" };
  }
};

export const toggleSupplier = async (id: string, isActive: boolean): Promise<{ error?: string }> => {
  let session;
  try {
    session = await requirePermission("master.cancel");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const requestContext = await getRequestContext();
    const existingSupplier = await db.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        contactName: true,
        phone: true,
        address: true,
        taxId: true,
        creditTerm: true,
        isActive: true,
      },
    });
    if (!existingSupplier) {
      return { error: "Supplier not found" };
    }

    const updatedSupplier = await db.supplier.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        code: true,
        name: true,
        contactName: true,
        phone: true,
        address: true,
        taxId: true,
        creditTerm: true,
        isActive: true,
      },
    });
    const diff = diffEntity(
      toAuditSupplier(existingSupplier),
      toAuditSupplier(updatedSupplier),
    );

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: isActive ? AuditAction.UPDATE : AuditAction.CANCEL,
      entityType: "Supplier",
      entityId: updatedSupplier.id,
      entityRef: updatedSupplier.code ?? updatedSupplier.name,
      before: diff.before,
      after: diff.after,
      meta: { isActive },
    });
    revalidatePath("/admin/master/suppliers");
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
