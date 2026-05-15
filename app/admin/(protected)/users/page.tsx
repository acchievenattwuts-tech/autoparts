export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import ToggleUserButton from "./ToggleUserButton";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";

const UsersPage = async () => {
  await ensureAccessControlSetupOnce().catch(() => { /* non-fatal: setup runs on next request */ });
  await requirePermission("admin.users.view");

  const users = await db.user.findMany({
    include: {
      appRole: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ผู้ใช้งานระบบ"
        description="จัดการบัญชีผู้ใช้และบทบาทการใช้งาน"
        actions={
        <Link
          href="/admin/users/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          <Plus size={16} />
          เพิ่มผู้ใช้
        </Link>
        }
      />

      <AdminTableSection>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อผู้ใช้</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">Username</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">Legacy Role</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">บทบาท</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">เปลี่ยนรหัสผ่าน</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-gray-50 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">{user.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-600 dark:text-slate-300">{user.username ?? user.email}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{user.role}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{user.appRole?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-center">
                    {user.isActive ? (
                      <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
                    ) : (
                      <AdminStatusBadge tone="muted">ปิดใช้งาน</AdminStatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600 dark:text-slate-300">
                    {user.mustChangePassword ? "ค้างเปลี่ยน" : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <Link
                        href={`/admin/users/${user.id}/edit`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#162d4a]"
                      >
                        <Pencil size={12} />
                        แก้ไข
                      </Link>
                      <ToggleUserButton id={user.id} name={user.name} isActive={user.isActive} />
                    </AdminActionGroup>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </AdminTableSection>
    </div>
  );
};

export default UsersPage;
