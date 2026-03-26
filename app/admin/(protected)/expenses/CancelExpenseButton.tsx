"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelExpense } from "./actions";

const CancelExpenseButton = ({ id, expenseNo }: { id: string; expenseNo: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={id}
      docNo={expenseNo}
      idFieldName="expenseId"
      cancelAction={cancelExpense}
      onSuccess={() => router.refresh()}
    />
  );
};

export default CancelExpenseButton;
