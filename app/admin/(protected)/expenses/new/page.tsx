export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Receipt, ChevronRight } from "lucide-react";
import NewExpenseForm from "./NewExpenseForm";
import { getSiteConfig } from "@/lib/site-config";

const NewExpensePage = async () => {
  await requirePermission("expenses.create");

  const [expenseCodes, config] = await Promise.all([
    db.expenseCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    getSiteConfig(),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/admin/expenses" className="hover:text-[#1e3a5f]">ค่าใช้จ่าย</Link>
        <ChevronRight size={14} />
        <span className="text-gray-900">บันทึกรายการใหม่</span>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Receipt size={22} className="text-[#1e3a5f]" />
        <h1 className="font-kanit text-2xl font-bold text-gray-900">บันทึกค่าใช้จ่าย</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <NewExpenseForm
          expenseCodes={expenseCodes}
          defaultVatType={config.vatType}
          defaultVatRate={config.vatRate}
        />
      </div>
    </div>
  );
};

export default NewExpensePage;
