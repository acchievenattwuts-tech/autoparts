export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { ExpenseCodeForm, ExpenseCodeToggleButton } from "./ExpenseCodeClient";

const ExpenseCodesPage = async () => {
  const codes = await db.expenseCode.findMany({
    orderBy: { code: "asc" },
    include: { _count: { select: { items: true } } },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">รหัสค่าใช้จ่าย</h1>
        <p className="text-sm text-gray-500 mt-1">จัดการรหัสค่าใช้จ่ายที่ใช้ในระบบบันทึกค่าใช้จ่าย</p>
      </div>

      <ExpenseCodeForm />

      <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm text-gray-500">
            รหัสทั้งหมด:{" "}
            <span className="font-medium text-gray-700">{codes.length} รายการ</span>
          </p>
        </div>

        {codes.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">ยังไม่มีรหัสค่าใช้จ่าย</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">รหัส</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ชื่อ</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">คำอธิบาย</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">ใช้งาน</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">รายการ</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className={`border-t border-gray-50 transition-colors ${c.isActive ? "hover:bg-gray-50" : "bg-gray-50 opacity-60"}`}>
                    <td className="py-3 px-4 font-mono font-medium text-[#1e3a5f]">{c.code}</td>
                    <td className="py-3 px-4 text-gray-800 font-medium">{c.name}</td>
                    <td className="py-3 px-4 text-gray-500">{c.description ?? <span className="text-gray-300">—</span>}</td>
                    <td className="py-3 px-4 text-center">
                      {c.isActive ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ใช้งาน</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-500">ยกเลิก</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center text-gray-500">{c._count.items}</td>
                    <td className="py-3 px-4 text-right">
                      <ExpenseCodeToggleButton
                        id={c.id}
                        name={c.name}
                        isActive={c.isActive}
                      />
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
