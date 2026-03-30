export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import { ExpenseCodeForm, ExpenseCodeToggleButton } from "./ExpenseCodeClient";

const ExpenseCodesPage = async () => {
  await requirePermission("master.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const canCreate = hasPermissionAccess(role, permissions, "master.create");
  const canCancel = hasPermissionAccess(role, permissions, "master.cancel");

  const codes = await db.expenseCode.findMany({
    orderBy: { code: "asc" },
    include: { _count: { select: { items: true } } },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">รหัสค่าใช้จ่าย</h1>
        <p className="mt-1 text-sm text-gray-500">จัดการรหัสค่าใช้จ่ายที่ใช้ในระบบบันทึกค่าใช้จ่าย</p>
      </div>

      {canCreate && <ExpenseCodeForm />}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="text-sm text-gray-500">
            รหัสทั้งหมด: <span className="font-medium text-gray-700">{codes.length} รายการ</span>
          </p>
        </div>

        {codes.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">ยังไม่มีรหัสค่าใช้จ่าย</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">รหัส</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">ชื่อ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">คำอธิบาย</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">ใช้งาน</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">รายการ</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr
                    key={code.id}
                    className={`border-t border-gray-50 transition-colors ${
                      code.isActive ? "hover:bg-gray-50" : "bg-gray-50 opacity-60"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f]">{code.code}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{code.name}</td>
                    <td className="px-4 py-3 text-gray-500">{code.description ?? <span className="text-gray-300">-</span>}</td>
                    <td className="px-4 py-3 text-center">
                      {code.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">ใช้งาน</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">ยกเลิก</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">{code._count.items}</td>
                    <td className="px-4 py-3 text-right">
                      {canCancel ? (
                        <ExpenseCodeToggleButton id={code.id} name={code.name} isActive={code.isActive} />
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExpenseCodesPage;
