export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";

const ExpenseDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("expenses.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "expenses.update");
  const { id } = await params;

  const expense = await db.expense.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        include: {
          expenseCode: { select: { code: true, name: true } },
        },
      },
    },
  });

  if (!expense) notFound();

  const vatLabel: Record<string, string> = {
    NO_VAT:        "ไม่มี VAT",
    EXCLUDING_VAT: "แยก VAT",
    INCLUDING_VAT:  "รวม VAT แล้ว",
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <NavLink
          href="/admin/expenses"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> ค่าใช้จ่ายทั้งหมด
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{expense.expenseNo}</span>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-white/10">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">บันทึกค่าใช้จ่าย</h1>
            {expense.status === "CANCELLED" ? (
              <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
            ) : (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-emerald-500/20 dark:text-emerald-300">ใช้งาน</span>
            )}
          </div>
          {expense.status === "ACTIVE" && canUpdate && (
            <NavLink
              href={`/admin/expenses/${id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
            >
              <Pencil size={14} /> แก้ไข
            </NavLink>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">เลขที่เอกสาร</p>
            <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{expense.expenseNo}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">วันที่</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {formatDateThai(expense.expenseDate)}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ภาษี</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{vatLabel[expense.vatType] ?? expense.vatType}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ผู้บันทึก</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{expense.user?.name ?? "-"}</p>
          </div>
          {expense.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">หมายเหตุ</p>
              <p className="text-gray-700 dark:text-slate-300">{expense.note}</p>
            </div>
          )}
          {expense.status === "CANCELLED" && expense.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">เหตุผลยกเลิก</p>
              <p className="text-red-600 dark:text-rose-400">{expense.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          รายการค่าใช้จ่าย
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">ประเภท</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">รายละเอียด</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {expense.items.map((item) => (
                <tr key={item.id} className="border-t border-gray-50 dark:border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{item.expenseCode.code}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{item.expenseCode.name}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{item.description ?? "-"}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-slate-100">
                    {Number(item.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5">
              {expense.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={3} className="px-3 py-1 text-right text-sm text-gray-500 dark:text-slate-400">ยอดก่อนภาษี</td>
                    <td className="px-3 py-1 text-right text-gray-700 dark:text-slate-300">
                      {Number(expense.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-3 py-1 text-right text-sm text-gray-500 dark:text-slate-400">
                      VAT {Number(expense.vatRate)}%
                    </td>
                    <td className="px-3 py-1 text-right text-gray-700 dark:text-slate-300">
                      +{Number(expense.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={3} className="px-3 py-3 text-right font-semibold text-gray-700 dark:text-slate-300">ยอดสุทธิ</td>
                <td className="px-3 py-3 text-right text-base font-bold text-[#1e3a5f] dark:text-sky-300">
                  {Number(expense.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ExpenseDetailPage;
