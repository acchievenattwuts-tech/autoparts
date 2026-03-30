export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus, Shield } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";

const RolesPage = async () => {
  await ensureAccessControlSetupOnce().catch(() => { /* non-fatal: setup runs on next request */ });
  await requirePermission("admin.roles.view");

  const roles = await db.appRole.findMany({
    include: {
      _count: {
        select: {
          users: true,
          permissions: true,
        },
      },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">บทบาทและสิทธิ์</h1>
          <p className="text-sm text-gray-500 mt-1">ตั้งค่าสิทธิ์ตามเมนูและ action หลักของระบบ</p>
        </div>
        <Link
          href="/admin/roles/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          เพิ่มบทบาท
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {roles.map((role) => (
          <Link
            key={role.id}
            href={`/admin/roles/${role.id}/edit`}
            className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:border-[#1e3a5f]/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Shield size={18} className="text-[#1e3a5f]" />
                  <h2 className="font-kanit text-lg font-semibold text-gray-900">{role.name}</h2>
                  {role.isSystem && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                      ระบบ
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-2">{role.description ?? "ไม่มีคำอธิบาย"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-400">ผู้ใช้</p>
                <p className="text-lg font-semibold text-gray-900">{role._count.users}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-400">สิทธิ์</p>
                <p className="text-lg font-semibold text-gray-900">{role._count.permissions}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default RolesPage;
