"use client";

import { useRouter } from "next/navigation";
import { PeriodLockCancelButton } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelPurchaseReturn } from "./actions";

const PurchaseReturnCancelButton = ({
  returnId,
  docNo,
  periodLock = null,
}: {
  returnId: string;
  docNo: string;
  periodLock?: PeriodLockView | null;
}) => {
  const router = useRouter();
  return (
    <PeriodLockCancelButton
      periodLock={periodLock}
      docId={returnId}
      docNo={docNo}
      idFieldName="returnId"
      cancelAction={cancelPurchaseReturn}
      onSuccess={() => router.refresh()}
    />
  );
};

export default PurchaseReturnCancelButton;
