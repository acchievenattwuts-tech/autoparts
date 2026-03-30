export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import UserForm from "../UserForm";

const NewUserPage = async () => {
  await ensureAccessControlSetupOnce();
  await requirePermission("admin.users.create");

  const roleOptions = await db.appRole.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true },
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> รายการผู้ใช้
        </Link>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">เพิ่มผู้ใช้ใหม่</h1>
      <UserForm roleOptions={roleOptions} />
    </div>
  );
};

export default NewUserPage;
