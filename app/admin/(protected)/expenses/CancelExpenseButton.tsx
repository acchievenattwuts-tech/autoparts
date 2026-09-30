"use client";

import { useRouter } from "next/navigation";
import { PeriodLockCancelButton } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelExpense } from "./actions";

const CancelExpenseButton = ({
  id,
  expenseNo,
  periodLock = null,
}: {
  id: string;
  expenseNo: string;
  periodLock?: PeriodLockView | null;
}) => {
  const router = useRouter();
  return (
    <PeriodLockCancelButton
      periodLock={periodLock}
      docId={id}
      docNo={expenseNo}
      idFieldName="expenseId"
      cancelAction={cancelExpense}
      onSuccess={() => router.refresh()}
    />
  );
};

export default CancelExpenseButton;
