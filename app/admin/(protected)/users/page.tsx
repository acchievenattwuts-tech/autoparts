export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import ToggleUserButton from "./ToggleUserButton";

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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">ผู้ใช้งานระบบ</h1>
          <p className="text-sm text-gray-500 mt-1">จัดการบัญชีผู้ใช้และบทบาทการใช้งาน</p>
        </div>
        <Link
          href="/admin/users/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          เพิ่มผู้ใช้
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ชื่อผู้ใช้</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Username</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Legacy Role</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">บทบาท</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600">เปลี่ยนรหัสผ่าน</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">{user.name}</td>
                  <td className="py-3 px-4 text-gray-600 font-mono">{user.username ?? user.email}</td>
                  <td className="py-3 px-4 text-gray-600">{user.role}</td>
                  <td className="py-3 px-4 text-gray-600">{user.appRole?.name ?? "-"}</td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {user.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center text-gray-600">
                    {user.mustChangePassword ? "ค้างเปลี่ยน" : "-"}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/users/${user.id}/edit`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f] hover:bg-[#162d4a] text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        <Pencil size={12} />
                        แก้ไข
                      </Link>
                      <ToggleUserButton id={user.id} name={user.name} isActive={user.isActive} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UsersPage;
