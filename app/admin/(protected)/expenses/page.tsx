export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Receipt, Plus, Eye, Pencil } from "lucide-react";
import CancelExpenseButton from "./CancelExpenseButton";
import Pagination from "@/components/shared/Pagination";

const PAGE_SIZE = 30;

interface ExpensePageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

const ExpensePage = async ({ searchParams }: ExpensePageProps) => {
  const { q, status, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const whereCondition = {
    AND: [
      status ? { status: status as "ACTIVE" | "CANCELLED" } : {},
      q
        ? {
            OR: [
              { expenseNo: { contains: q, mode: "insensitive" as const } },
              { note: { contains: q, mode: "insensitive" as const } },
              { items: { some: { description: { contains: q, mode: "insensitive" as const } } } },
              { items: { some: { expenseCode: { name: { contains: q, mode: "insensitive" as const } } } } },
            ],
          }
        : {},
    ],
  };

  const [expenses, totalCount] = await Promise.all([
    db.expense.findMany({
      where: whereCondition,
      orderBy: [{ expenseDate: "desc" }, { expenseNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      select: {
        id:            true,
        expenseNo:     true,
        expenseDate:   true,
        totalAmount:   true,
        subtotalAmount: true,
        vatAmount:     true,
        vatType:       true,
        vatRate:       true,
        netAmount:     true,
        note:          true,
        status:        true,
        cancelNote:    true,
        items: {
          select: {
            id:          true,
            amount:      true,
            description: true,
            expenseCode: { select: { code: true, name: true } },
          },
        },
      },
    }),
    db.expense.count({ where: whereCondition }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const activeExpenses = expenses.filter((e) => e.status === "ACTIVE");
  const totalNet = activeExpenses.reduce((s, e) => s + Number(e.netAmount), 0);

  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (status) paginationParams.status = status;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Receipt size={22} className="text-[#1e3a5f]" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900">ค่าใช้จ่าย</h1>
        </div>
        <Link
          href="/admin/expenses/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> บันทึกรายการใหม่
        </Link>
      </div>

      {/* Search + Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <form method="GET" className="flex gap-3 flex-wrap">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="ค้นหาเลขที่, รหัส, รายละเอียด..."
            className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
          />
          <select
            name="status"
            defaultValue={status ?? "ACTIVE"}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white"
          >
            <option value="ACTIVE">เฉพาะที่ใช้งาน</option>
            <option value="CANCELLED">เฉพาะที่ยกเลิก</option>
            <option value="">ทั้งหมด</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
          >
            ค้นหา
          </button>
          {(q || (status && status !== "ACTIVE")) && (
            <Link
              href="/admin/expenses"
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors"
            >
              ล้าง
            </Link>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            ทั้งหมด <span className="font-medium text-gray-700">{totalCount} เอกสาร</span>
          </p>
          <p className="text-sm font-medium text-gray-700">
            ยอดสุทธิ (ACTIVE){" "}
            <span className="text-[#1e3a5f] font-semibold">
              {totalNet.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
            </span>
          </p>
        </div>

        {expenses.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">ไม่พบรายการค่าใช้จ่าย</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">รายการ</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">ก่อน VAT</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">VAT</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">สถานะ</th>
                  <th className="py-3 px-4 w-20" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => {
                  const isCancelled = exp.status === "CANCELLED";
                  return (
                    <tr
                      key={exp.id}
                      className={`border-t border-gray-50 transition-colors ${isCancelled ? "opacity-50" : "hover:bg-gray-50"}`}
                    >
                      <td className="py-2.5 px-4 font-mono text-xs text-[#1e3a5f] font-medium">
                        {exp.expenseNo}
                      </td>
                      <td className="py-2.5 px-4 text-gray-600 whitespace-nowrap">
                        {new Date(exp.expenseDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="space-y-0.5">
                          {exp.items.map((it) => (
                            <div key={it.id} className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                {it.expenseCode.code}
                              </span>
                              <span className="text-gray-700 text-xs">
                                {it.description ?? it.expenseCode.name}
                              </span>
                              <span className="text-gray-400 text-xs ml-auto">
                                {Number(it.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                          {exp.note && (
                            <p className="text-xs text-gray-400 mt-0.5">({exp.note})</p>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-600">
                        {Number(exp.vatAmount) > 0
                          ? Number(exp.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-600">
                        {Number(exp.vatAmount) > 0
                          ? Number(exp.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-gray-900">
                        {Number(exp.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {isCancelled ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                            ยกเลิก
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            ใช้งาน
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2 justify-end">
                          <Link href={`/admin/expenses/${exp.id}`}
                            className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                            <Eye size={14} /> ดู
                          </Link>
                          {!isCancelled && (
                            <>
                              <Link href={`/admin/expenses/${exp.id}/edit`}
                                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                                <Pencil size={14} /> แก้ไข
                              </Link>
                              <CancelExpenseButton id={exp.id} expenseNo={exp.expenseNo} />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                <tr>
                  <td colSpan={5} className="py-3 px-4 text-right text-sm font-semibold text-gray-700">
                    รวมยอดสุทธิ (ACTIVE)
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-gray-900">
                    {totalNet.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    <span className="ml-1 text-xs font-normal text-gray-500">บาท</span>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Pagination
        currentPage={pageNum}
        totalPages={totalPages}
        basePath="/admin/expenses"
        searchParams={paginationParams}
      />
    </div>
  );
};

export default ExpensePage;
