"use client";

import { useRouter } from "next/navigation";
import { PeriodLockCancelButton } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelPurchase } from "./actions";

const PurchaseCancelButton = ({
  purchaseId,
  docNo,
  periodLock = null,
}: {
  purchaseId: string;
  docNo: string;
  periodLock?: PeriodLockView | null;
}) => {
  const router = useRouter();
  return (
    <PeriodLockCancelButton
      periodLock={periodLock}
      docId={purchaseId}
      docNo={docNo}
      idFieldName="purchaseId"
      cancelAction={cancelPurchase}
      onSuccess={() => router.refresh()}
    />
  );
};

export default PurchaseCancelButton;
