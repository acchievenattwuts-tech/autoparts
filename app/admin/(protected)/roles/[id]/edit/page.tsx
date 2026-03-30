export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ensureAccessControlSetupOnce, PERMISSION_CATALOG } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import RoleForm from "../../RoleForm";

const EditRolePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await ensureAccessControlSetupOnce();
  await requirePermission("admin.roles.manage");

  const { id } = await params;

  const [role, copyRoleOptions] = await Promise.all([
    db.appRole.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: { select: { key: true } },
          },
        },
      },
    }),
    db.appRole.findMany({
      include: {
        permissions: {
          include: {
            permission: { select: { key: true } },
          },
        },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    }),
  ]);

  if (!role) notFound();

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/roles" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> รายการบทบาท
        </Link>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขบทบาท</h1>
      <RoleForm
        role={{
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          permissionKeys: role.permissions.map((permission) => permission.permission.key),
        }}
        permissions={PERMISSION_CATALOG.map((permission) => ({
          key: permission.key,
          group: permission.group,
          label: permission.label,
        }))}
        copyRoleOptions={copyRoleOptions.map((item) => ({
          id: item.id,
          name: item.name,
          permissionKeys: item.permissions.map((permission) => permission.permission.key),
        }))}
      />
    </div>
  );
};

export default EditRolePage;
