"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import {
  ALL_MENU_PERMISSION_KEYS,
  ensureAccessControlSetup,
  type PermissionKey,
} from "@/lib/access-control";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";

const roleSchema = z.object({
  name: z.string().min(1, "กรุณาระบุชื่อบทบาท").max(60),
  description: z.string().max(200).optional(),
  permissionKeys: z.array(z.string()).min(1, "กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ"),
});

function toPermissionKeys(permissionKeys: string[]): PermissionKey[] {
  return permissionKeys.filter((permissionKey): permissionKey is PermissionKey =>
    ALL_MENU_PERMISSION_KEYS.includes(permissionKey as PermissionKey)
  );
}

function toAuditRole(role: {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Array<{ permission: { key: string } }>;
}) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionKeys: role.permissions
      .map((item) => item.permission.key)
      .sort((left, right) => left.localeCompare(right)),
  };
}

export async function createRole(
  formData: FormData
): Promise<{ success?: boolean; id?: string; error?: string }> {
  await ensureAccessControlSetup();

  let session;
  try {
    session = await requirePermission("admin.roles.manage");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  let rawPermissionKeys: string[] = [];
  try {
    rawPermissionKeys = JSON.parse((formData.get("permissionKeys") as string) || "[]") as string[];
  } catch {
    return { error: "รูปแบบสิทธิ์ไม่ถูกต้อง" };
  }

  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    description: (formData.get("description") as string) || undefined,
    permissionKeys: rawPermissionKeys,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const permissionKeys = toPermissionKeys(parsed.data.permissionKeys);
  if (permissionKeys.length === 0) {
    return { error: "กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ" };
  }

  try {
    const requestContext = await getRequestContext();
    const permissions = await db.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true },
    });

    const role = await db.appRole.create({
      data: {
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
      },
      select: { id: true, name: true, description: true, isSystem: true },
    });

    await db.appRolePermission.createMany({
      data: permissions.map((permission) => ({
        appRoleId: role.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "AppRole",
      entityId: role.id,
      entityRef: role.name,
      after: {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissionKeys,
      },
    });

    revalidatePath("/admin/roles");
    return { success: true, id: role.id };
  } catch (error) {
    console.error("[createRole]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function updateRole(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  await ensureAccessControlSetup();

  let session;
  try {
    session = await requirePermission("admin.roles.manage");
  } catch {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  let rawPermissionKeys: string[] = [];
  try {
    rawPermissionKeys = JSON.parse((formData.get("permissionKeys") as string) || "[]") as string[];
  } catch {
    return { error: "รูปแบบสิทธิ์ไม่ถูกต้อง" };
  }

  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    description: (formData.get("description") as string) || undefined,
    permissionKeys: rawPermissionKeys,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const permissionKeys = toPermissionKeys(parsed.data.permissionKeys);
  if (permissionKeys.length === 0) {
    return { error: "กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ" };
  }

  try {
    const requestContext = await getRequestContext();
    const role = await db.appRole.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: {
              select: { key: true },
            },
          },
        },
      },
    });

    if (!role) {
      return { error: "ไม่พบบทบาทที่ต้องการแก้ไข" };
    }

    const permissions = await db.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true },
    });

    await db.$transaction(async (tx) => {
      await tx.appRole.update({
        where: { id },
        data: {
          name: role.isSystem ? undefined : parsed.data.name.trim(),
          description: parsed.data.description?.trim() || null,
        },
      });

      await tx.appRolePermission.deleteMany({
        where: { appRoleId: id },
      });

      await tx.appRolePermission.createMany({
        data: permissions.map((permission) => ({
          appRoleId: id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
    });

    const updatedRole = await db.appRole.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: {
              select: { key: true },
            },
          },
        },
      },
    });

    if (updatedRole) {
      const beforeRole = toAuditRole(role);
      const afterRole = toAuditRole(updatedRole);
      const diff = diffEntity(beforeRole, afterRole);
      const permissionChanged =
        JSON.stringify(beforeRole.permissionKeys) !== JSON.stringify(afterRole.permissionKeys);

      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: permissionChanged ? AuditAction.PERMISSION_CHANGE : AuditAction.ROLE_CHANGE,
        entityType: "AppRole",
        entityId: updatedRole.id,
        entityRef: updatedRole.name,
        before: diff.before,
        after: diff.after,
      });
    }

    revalidatePath("/admin/roles");
    revalidatePath(`/admin/roles/${id}/edit`);
    return { success: true };
  } catch (error) {
    console.error("[updateRole]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
