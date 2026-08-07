export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import { ExpenseCodeForm, ExpenseCodeRow } from "./ExpenseCodeClient";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminTableSection from "@/components/shared/AdminTableSection";

const ExpenseCodesPage = async () => {
  await requirePermission("master.view");

  const session = await getSession();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const canCreate = hasPermissionAccess(role, permissions, "master.create");
  const canUpdate = hasPermissionAccess(role, permissions, "master.update");
  const canCancel = hasPermissionAccess(role, permissions, "master.cancel");

  // Narrowed to the columns ExpenseCodeRow declares. `include` pulled every
  // column, including createdAt and deliveryCommissionSlot, which nothing here
  // renders. Row set and order are unchanged.
  const codes = await db.expenseCode.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isActive: true,
      isDeliveryCommission: true,
      _count: { select: { items: true } },
    },
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="รหัสค่าใช้จ่าย"
        description="จัดการรหัสค่าใช้จ่ายที่ใช้ในระบบบันทึกค่าใช้จ่าย"
      />

      {canCreate && <ExpenseCodeForm />}

      <AdminTableSection>
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            รหัสทั้งหมด: <span className="font-medium text-gray-700 dark:text-slate-200">{codes.length} รายการ</span>
          </p>
        </div>

        {codes.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400 dark:text-slate-500">ยังไม่มีรหัสค่าใช้จ่าย</div>
        ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">คำอธิบาย</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">ใช้งาน</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">รายการ</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <ExpenseCodeRow
                    key={code.id}
                    expenseCode={code}
                    canUpdate={canUpdate}
                    canCancel={canCancel}
                  />
                ))}
              </tbody>
            </table>
        )}
      </AdminTableSection>
    </div>
  );
};

export default ExpenseCodesPage;
