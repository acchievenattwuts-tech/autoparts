export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import UserForm from "../../UserForm";

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
        role: true,
        appRoleId: true,
        mustChangePassword: true,
        isActive: true,
        signatureUrl: true,
      },
    }),
    db.appRole.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true },
    }),
  ]);

  if (!user) notFound();

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> รายการผู้ใช้
        </Link>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขผู้ใช้</h1>
      <UserForm
        user={{
          ...user,
          username: user.username ?? user.email,
        }}
        roleOptions={roleOptions}
      />
    </div>
  );
};

export default EditUserPage;
