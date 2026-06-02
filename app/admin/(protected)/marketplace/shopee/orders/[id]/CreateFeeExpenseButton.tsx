"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, ReceiptText } from "lucide-react";

import { createFeeExpenseFromOrderAction } from "../actions";

const CreateFeeExpenseButton = ({ orderImportId }: { orderImportId: string }) => {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [expenseId, setExpenseId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await createFeeExpenseFromOrderAction(orderImportId);
            if (result.ok) {
              setExpenseId(result.expenseId);
              setMessage(result.reused ? `มี Expense อยู่แล้ว: ${result.expenseNo}` : `สร้าง Expense สำเร็จ: ${result.expenseNo}`);
            } else {
              setMessage(result.error);
            }
          });
        }}
        className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-500 dark:hover:bg-orange-400"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
        สร้าง Expense ค่า Shopee
      </button>
      {message ? (
        <div className="text-xs text-slate-600 dark:text-slate-300">
          {expenseId ? (
            <Link href={`/admin/expenses/${expenseId}`} className="font-medium text-orange-700 hover:underline dark:text-orange-300">
              {message}
            </Link>
          ) : (
            message
          )}
        </div>
      ) : null}
    </div>
  );
};

export default CreateFeeExpenseButton;
