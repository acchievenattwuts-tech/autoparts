export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import UserForm from "../../UserForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const EditUserPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await ensureAccessControlSetupOnce();
  await requirePermission("admin.users.update");

  const { id } = await params;

  const [user, roleOptions] = await Promise.all([
    db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        role: true,
        appRoleId: true,
        mustChangePassword: true,
        isActive: true,
        signatureUrl: true,
        directPermissionGrants: { select: { permission: { select: { key: true } } } },
      },
    }),
    db.appRole.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true },
    }),
  ]);

  if (!user) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> รายการผู้ใช้
        </Link>
      </div>
      <AdminPageHeader
        title="แก้ไขผู้ใช้"
        description={user.name}
      />
      <UserForm
        user={{
          ...user,
          username: user.username ?? user.email,
          knowledgeAccess: user.directPermissionGrants.some((item) => item.permission.key === "knowledge.view"),
        }}
        roleOptions={roleOptions}
      />
    </div>
  );
};

export default EditUserPage;
