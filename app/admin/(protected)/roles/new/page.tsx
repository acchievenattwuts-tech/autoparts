export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ensureAccessControlSetupOnce, PERMISSION_CATALOG } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import RoleForm from "../RoleForm";

const NewRolePage = async () => {
  await ensureAccessControlSetupOnce();
  await requirePermission("admin.roles.manage");

  const copyRoleOptions = await db.appRole.findMany({
    include: {
      permissions: {
        include: {
          permission: { select: { key: true } },
        },
      },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/roles" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> รายการบทบาท
        </Link>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">เพิ่มบทบาทใหม่</h1>
      <RoleForm
        permissions={PERMISSION_CATALOG.map((permission) => ({
          key: permission.key,
          group: permission.group,
          label: permission.label,
        }))}
        copyRoleOptions={copyRoleOptions.map((role) => ({
          id: role.id,
          name: role.name,
          permissionKeys: role.permissions.map((permission) => permission.permission.key),
        }))}
      />
    </div>
  );
};

export default NewRolePage;
