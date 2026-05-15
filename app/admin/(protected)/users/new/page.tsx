export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import UserForm from "../UserForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const NewUserPage = async () => {
  await ensureAccessControlSetupOnce();
  await requirePermission("admin.users.create");

  const roleOptions = await db.appRole.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> รายการผู้ใช้
        </Link>
      </div>
      <AdminPageHeader
        title="เพิ่มผู้ใช้ใหม่"
        description="สร้างบัญชีผู้ใช้และกำหนดบทบาทเริ่มต้น"
      />
      <UserForm roleOptions={roleOptions} />
    </div>
  );
};

export default NewUserPage;
