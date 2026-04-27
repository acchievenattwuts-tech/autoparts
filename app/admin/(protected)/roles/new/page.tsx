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
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/roles"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รายการบทบาท
        </Link>
      </div>
      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
        เพิ่มบทบาทใหม่
      </h1>
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
