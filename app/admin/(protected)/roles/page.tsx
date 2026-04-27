export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus, Shield } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";

const RolesPage = async () => {
  await ensureAccessControlSetupOnce().catch(() => {});
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            บทบาทและสิทธิ์
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            ตั้งค่าสิทธิ์ตามเมนูและ action หลักของระบบ
          </p>
        </div>
        <Link
          href="/admin/roles/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} />
          เพิ่มบทบาท
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {roles.map((role) => (
          <Link
            key={role.id}
            href={`/admin/roles/${role.id}/edit`}
            className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-colors hover:border-[#1e3a5f]/30 dark:border-white/10 dark:bg-slate-950/40 dark:hover:border-sky-400/40"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Shield size={18} className="text-[#1e3a5f] dark:text-sky-300" />
                  <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
                    {role.name}
                  </h2>
                  {role.isSystem ? (
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-sky-500/10 dark:text-sky-300">
                      ระบบ
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
                  {role.description ?? "ไม่มีคำอธิบาย"}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-slate-900/70">
                <p className="text-xs text-gray-400 dark:text-slate-500">ผู้ใช้</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                  {role._count.users}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-slate-900/70">
                <p className="text-xs text-gray-400 dark:text-slate-500">สิทธิ์</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                  {role._count.permissions}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default RolesPage;
