export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getActiveExpenseCodeOptions } from "@/lib/admin-master-options";
import { formatDateOnlyForInput } from "@/lib/th-date";
import NewExpenseForm from "../../new/NewExpenseForm";

const EditExpensePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("expenses.update");

  const { id } = await params;

  const [expense, expenseCodes, config, cashBankAccounts, expensePayments] = await Promise.all([
    db.expense.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: [{ lineNo: "asc" }, { id: "asc" }],
          include: { expenseCode: { select: { id: true } } },
        },
        _count: { select: { attachments: true } },
      },
    }),
    getActiveExpenseCodeOptions(),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
    db.documentPayment.findMany({
      where: { docType: "EXPENSE", docId: id },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    }),
  ]);

  if (!expense) notFound();
  if (expense.status === "CANCELLED") redirect(`/admin/expenses/${id}`);

  const initialData = {
    id,
      expenseDate: formatDateOnlyForInput(expense.expenseDate),
    cashBankAccountId: expense.cashBankAccountId ?? "",
    payments: expensePayments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: Number(payment.amount),
    })),
    vatType:     expense.vatType,
    vatRate:     Number(expense.vatRate),
    note:        expense.note ?? "",
    attachmentCount: expense._count.attachments,
    items:       expense.items.map((item) => ({
      expenseCodeId: item.expenseCodeId,
      description:   item.description ?? "",
      amount:        Number(item.amount),
    })),
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <NavLink href={`/admin/expenses/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> {expense.expenseNo}
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">แก้ไขบันทึกค่าใช้จ่าย</h1>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 dark:border-white/10 dark:bg-[#101b2e] p-6">
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
