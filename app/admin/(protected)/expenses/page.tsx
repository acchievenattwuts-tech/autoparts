export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Receipt, Plus } from "lucide-react";
import DeleteExpenseButton from "./DeleteExpenseButton";

const CATEGORY_LABELS: Record<string, string> = {
  RENT:        "ค่าเช่า",
  UTILITIES:   "ค่าสาธารณูปโภค",
  SALARY:      "เงินเดือน/ค่าจ้าง",
  TRANSPORT:   "ค่าขนส่ง",
  MARKETING:   "ค่าการตลาด",
  MAINTENANCE: "ค่าซ่อมบำรุง",
  OTHER:       "อื่นๆ",
};

const CATEGORY_BADGE: Record<string, string> = {
  RENT:        "bg-blue-100 text-blue-700",
  UTILITIES:   "bg-yellow-100 text-yellow-700",
  SALARY:      "bg-green-100 text-green-700",
  TRANSPORT:   "bg-orange-100 text-orange-700",
  MARKETING:   "bg-purple-100 text-purple-700",
  MAINTENANCE: "bg-red-100 text-red-700",
  OTHER:       "bg-gray-100 text-gray-600",
};

interface ExpensePageProps {
  searchParams: Promise<{ q?: string; category?: string }>;
}

const ExpensePage = async ({ searchParams }: ExpensePageProps) => {
  const { q, category } = await searchParams;

  const expenses = await db.expense.findMany({
    where: {
      AND: [
        q ? { description: { contains: q, mode: "insensitive" } } : {},
        category ? { category: category as never } : {},
      ],
    },
    orderBy: { expenseDate: "desc" },
    take: 100,
    select: {
      id: true,
      expenseDate: true,
      category: true,
      description: true,
      amount: true,
      subtotalAmount: true,
      vatAmount: true,
      vatType: true,
      vatRate: true,
      note: true,
    },
  });

  const totalAmount = expenses.reduce((s, e) => s + Number(e.amount), 0);

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
          <Plus size={16} />
          บันทึกรายการใหม่
        </Link>
      </div>

      {/* Search + Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <form method="GET" className="flex gap-3 flex-wrap">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="ค้นหารายละเอียด..."
            className="flex-1 min-w-40 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
          />
          <select
            name="category"
            defaultValue={category ?? ""}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white"
          >
            <option value="">ทุกประเภท</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
          >
            ค้นหา
          </button>
          {(q || category) && (
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
            ทั้งหมด <span className="font-medium text-gray-700">{expenses.length} รายการ</span>
          </p>
          <p className="text-sm font-medium text-gray-700">
            รวมทั้งสิ้น{" "}
            <span className="text-[#1e3a5f] font-semibold">
              {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
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
                  <th className="text-left py-3 px-4 font-medium text-gray-600 w-8">#</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภท</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">รายละเอียด</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">ก่อน VAT</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">VAT</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                  <th className="py-3 px-4 w-10" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp, idx) => (
                  <tr key={exp.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-4 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-2.5 px-4 text-gray-600 whitespace-nowrap">
                      {new Date(exp.expenseDate).toLocaleDateString("th-TH")}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_BADGE[exp.category] ?? "bg-gray-100 text-gray-600"}`}>
                        {CATEGORY_LABELS[exp.category] ?? exp.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-gray-700 max-w-xs truncate">
                      {exp.description}
                      {exp.note && (
                        <span className="ml-2 text-gray-400 text-xs">({exp.note})</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right text-gray-600">
                      {Number(exp.vatAmount) > 0
                        ? Number(exp.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
                        : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="py-2.5 px-4 text-right text-gray-600">
                      {Number(exp.vatAmount) > 0
                        ? Number(exp.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
                        : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-gray-900">
                      {Number(exp.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <DeleteExpenseButton id={exp.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                <tr>
                  <td colSpan={6} className="py-3 px-4 text-right text-sm font-semibold text-gray-700">
                    รวมค่าใช้จ่ายทั้งสิ้น
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-gray-900">
                    {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    <span className="ml-1 text-xs font-normal text-gray-500">บาท</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExpensePage;
