"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction, PriceTier } from "@/lib/generated/prisma";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/require-auth";
import { ADMIN_MASTER_OPTION_TAGS } from "@/lib/admin-master-options";

const ID_PATTERN = /^[a-z0-9]+$/;

const customerTypeSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อประเภทลูกค้า").max(100),
  priceTier: z.nativeEnum(PriceTier),
  sortOrder: z.number().int().min(0).max(9999),
});

/** รับเฉพาะค่าที่อยู่ใน enum จริง — ค่าอื่น/ค่าว่าง ตกไปที่ RETAIL (ระดับราคาที่ปลอดภัยที่สุด) */
const parsePriceTier = (value: FormDataEntryValue | null): PriceTier => {
  if (value === "WHOLESALE") return PriceTier.WHOLESALE;
  if (value === "MEMBER") return PriceTier.MEMBER;
  return PriceTier.RETAIL;
};

const parseFormData = (formData: FormData) =>
  customerTypeSchema.safeParse({
    name: (formData.get("name") ?? "").toString().trim(),
    priceTier: parsePriceTier(formData.get("priceTier")),
    sortOrder: Number.parseInt((formData.get("sortOrder") ?? "0").toString(), 10) || 0,
  });

async function getCustomerTypeAuditSnapshot(id: string) {
  return db.customerType.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      priceTier: true,
      isActive: true,
      sortOrder: true,
      isSystem: true,
    },
  });
}

const refreshCaches = () => {
  updateTag(ADMIN_MASTER_OPTION_TAGS.customerTypes);
  revalidatePath("/admin/master/customer-types");
};

export const createCustomerType = async (formData: FormData): Promise<{ error?: string }> => {
  const session = await requirePermission("master.create").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  const parsed = parseFormData(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const created = await db.customerType.create({
      data: {
        name: parsed.data.name,
        priceTier: parsed.data.priceTier,
        sortOrder: parsed.data.sortOrder,
      },
    });
    const afterSnapshot = await getCustomerTypeAuditSnapshot(created.id);
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "CustomerType",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        after: afterSnapshot,
      });
    }

    refreshCaches();
    return {};
  } catch {
    return { error: "ชื่อประเภทลูกค้านี้มีอยู่แล้ว" };
  }
};

export const updateCustomerType = async (
  id: string,
  formData: FormData,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.update").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  if (!id || id.length > 50 || !ID_PATTERN.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = parseFormData(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const beforeSnapshot = await getCustomerTypeAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบประเภทลูกค้า" };
    // ประเภทระบบ (ลูกค้าทั่วไป) ห้ามเปลี่ยนชื่อ/สิทธิ์การเห็นราคา เพื่อคงพฤติกรรม default
    if (beforeSnapshot.isSystem) {
      return { error: "ประเภทลูกค้าระบบไม่สามารถแก้ไขได้" };
    }

    await db.customerType.update({
      where: { id },
      data: {
        name: parsed.data.name,
        priceTier: parsed.data.priceTier,
        sortOrder: parsed.data.sortOrder,
      },
    });
    const afterSnapshot = await getCustomerTypeAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "CustomerType",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        before: diff.before,
        after: diff.after,
      });
    }

    refreshCaches();
    return {};
  } catch {
    return { error: "ไม่สามารถแก้ไขได้ หรือชื่อนี้มีอยู่แล้ว" };
  }
};

export const toggleCustomerType = async (
  id: string,
  isActive: boolean,
): Promise<{ error?: string }> => {
  const session = await requirePermission("master.cancel").catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const requestContext = await getRequestContext();
  if (!id || id.length > 50 || !ID_PATTERN.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const beforeSnapshot = await getCustomerTypeAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบประเภทลูกค้า" };
    if (beforeSnapshot.isSystem) {
      return { error: "ประเภทลูกค้าระบบไม่สามารถปิดใช้งานได้" };
    }

    await db.customerType.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getCustomerTypeAuditSnapshot(id);
    if (afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "CustomerType",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.name,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }

    refreshCaches();
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
