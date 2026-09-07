"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { AuditAction, WhtPayeeType } from "@/lib/generated/prisma";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { reportCriticalError } from "@/lib/error-reporting";
import { requirePermission } from "@/lib/require-auth";

/**
 * ข้อมูลภาษีของผู้ถูกหักภาษี ณ ที่จ่าย — เก็บแยกจากตาราง Supplier
 * เพื่อไม่ให้กระทบ logic การซื้อ/จ่ายเดิม และเพราะแบบ ภ.ง.ด. กับไฟล์นำส่งกรมสรรพากร
 * บังคับให้ชื่อและที่อยู่แยกช่อง ซึ่ง Supplier เดิมเก็บเป็นข้อความก้อนเดียว
 */

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => value?.trim() || null);

const payeeProfileSchema = z.object({
  supplierId: z.string().min(1),
  payeeType: z.nativeEnum(WhtPayeeType),
  taxId13: z
    .string()
    .regex(/^\d{13}$/, "เลขประจำตัวผู้เสียภาษี/เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก"),
  taxId10: z
    .string()
    .optional()
    .transform((value) => value?.trim() || null)
    .refine((value) => value === null || /^\d{10}$/.test(value), {
      message: "เลขประจำตัวผู้เสียภาษีแบบ 10 หลักต้องเป็นตัวเลข 10 หลัก",
    }),
  titleName: optionalText(20),
  firstName: z.string().min(1, "กรุณาระบุชื่อผู้ถูกหักภาษี").max(200),
  lastName: optionalText(200),
  branchNo: z
    .string()
    .optional()
    .transform((value) => (value?.trim() ? value.trim().padStart(6, "0") : "000000"))
    .refine((value) => /^\d{6}$/.test(value), { message: "ลำดับที่สาขาต้องเป็นตัวเลขไม่เกิน 6 หลัก" }),
  addrNo: optionalText(100),
  addrRoad: optionalText(100),
  addrSubdistrict: optionalText(100),
  addrDistrict: optionalText(100),
  addrProvince: optionalText(100),
  addrPostcode: z
    .string()
    .optional()
    .transform((value) => value?.trim() || null)
    .refine((value) => value === null || /^\d{5}$/.test(value), {
      message: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก",
    }),
  isActive: z.enum(["true", "false"]).default("true"),
});

export async function saveWhtPayeeProfile(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("wht.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = payeeProfileSchema.safeParse({
    supplierId: formData.get("supplierId"),
    payeeType: formData.get("payeeType") ?? WhtPayeeType.JURISTIC,
    taxId13: formData.get("taxId13") ?? "",
    taxId10: formData.get("taxId10") ?? undefined,
    titleName: formData.get("titleName") ?? undefined,
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? undefined,
    branchNo: formData.get("branchNo") ?? undefined,
    addrNo: formData.get("addrNo") ?? undefined,
    addrRoad: formData.get("addrRoad") ?? undefined,
    addrSubdistrict: formData.get("addrSubdistrict") ?? undefined,
    addrDistrict: formData.get("addrDistrict") ?? undefined,
    addrProvince: formData.get("addrProvince") ?? undefined,
    addrPostcode: formData.get("addrPostcode") ?? undefined,
    isActive: formData.get("isActive") ?? "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supplierId, isActive, ...profile } = parsed.data;

  try {
    const supplier = await db.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, whtPayeeProfile: true },
    });
    if (!supplier) return { error: "ไม่พบผู้จำหน่าย" };

    const before = supplier.whtPayeeProfile;
    const data = { ...profile, isActive: isActive === "true" };

    await db.whtPayeeProfile.upsert({
      where: { supplierId },
      create: { supplierId, ...data },
      update: data,
    });

    const after = await db.whtPayeeProfile.findUnique({ where: { supplierId } });
    const requestContext = await getRequestContext();
    const diff = diffEntity(before ?? {}, after ?? {});
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: "WhtPayeeProfile",
      entityId: after?.id,
      entityRef: supplier.name,
      before: diff.before,
      after: diff.after,
    });

    revalidatePath("/admin/wht/payees");
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "wht.savePayeeProfile" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
