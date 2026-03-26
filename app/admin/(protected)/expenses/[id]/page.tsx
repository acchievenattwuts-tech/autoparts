export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";

const ExpenseDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  const expense = await db.expense.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      items: {
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
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/expenses"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> ค่าใช้จ่ายทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{expense.expenseNo}</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900">บันทึกค่าใช้จ่าย</h1>
            {expense.status === "CANCELLED" ? (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">ยกเลิกแล้ว</span>
            ) : (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ใช้งาน</span>
            )}
          </div>
          {expense.status === "ACTIVE" && (
            <Link href={`/admin/expenses/${id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] rounded-lg transition-colors">
              <Pencil size={14} /> แก้ไข
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <div>
            <p className="text-gray-500 mb-0.5">เลขที่เอกสาร</p>
            <p className="font-mono font-semibold text-[#1e3a5f]">{expense.expenseNo}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">วันที่</p>
            <p className="font-medium text-gray-900">
              {new Date(expense.expenseDate).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ภาษี</p>
            <p className="font-medium text-gray-900">{vatLabel[expense.vatType] ?? expense.vatType}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ผู้บันทึก</p>
            <p className="font-medium text-gray-900">{expense.user?.name ?? "-"}</p>
          </div>
          {expense.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">หมายเหตุ</p>
              <p className="text-gray-700">{expense.note}</p>
            </div>
          )}
          {expense.status === "CANCELLED" && expense.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">เหตุผลยกเลิก</p>
              <p className="text-red-600">{expense.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-4 pb-3 border-b border-gray-100">
          รายการค่าใช้จ่าย
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium text-gray-600">รหัส</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">ประเภท</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">รายละเอียด</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {expense.items.map((item) => (
                <tr key={item.id} className="border-t border-gray-50">
                  <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.expenseCode.code}</td>
                  <td className="py-2 px-3 text-gray-700">{item.expenseCode.name}</td>
                  <td className="py-2 px-3 text-gray-600">{item.description ?? "-"}</td>
                  <td className="py-2 px-3 text-right font-medium text-gray-900">
                    {Number(item.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              {expense.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={3} className="py-1 px-3 text-right text-sm text-gray-500">ยอดก่อนภาษี</td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      {Number(expense.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-1 px-3 text-right text-sm text-gray-500">
                      VAT {Number(expense.vatRate)}%
                    </td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      +{Number(expense.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={3} className="py-3 px-3 text-right font-semibold text-gray-700">ยอดสุทธิ</td>
                <td className="py-3 px-3 text-right font-bold text-[#1e3a5f] text-base">
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
