export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { formatDateOnlyForInput } from "@/lib/th-date";
import NewExpenseForm from "../../new/NewExpenseForm";

const EditExpensePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("expenses.update");

  const { id } = await params;

  const [expense, expenseCodes, config, cashBankAccounts] = await Promise.all([
    db.expense.findUnique({
      where: { id },
      include: {
        items: { include: { expenseCode: { select: { id: true } } } },
      },
    }),
    db.expenseCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  if (!expense) notFound();
  if (expense.status === "CANCELLED") redirect(`/admin/expenses/${id}`);

  const initialData = {
    id,
      expenseDate: formatDateOnlyForInput(expense.expenseDate),
    cashBankAccountId: expense.cashBankAccountId ?? "",
    vatType:     expense.vatType,
    vatRate:     Number(expense.vatRate),
    note:        expense.note ?? "",
    items:       expense.items.map((item) => ({
      expenseCodeId: item.expenseCodeId,
      description:   item.description ?? "",
      amount:        Number(item.amount),
    })),
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/expenses/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> {expense.expenseNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขบันทึกค่าใช้จ่าย</h1>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <NewExpenseForm
          expenseCodes={expenseCodes}
          cashBankAccounts={cashBankAccounts}
          defaultVatType={config.vatType}
          defaultVatRate={config.vatRate}
          initialData={initialData}
        />
      </div>
    </div>
  );
};

export default EditExpensePage;
