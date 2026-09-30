"use client";

import { useRouter } from "next/navigation";
import { PeriodLockCancelButton } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelSale } from "./actions";

const SaleCancelButton = ({
  saleId,
  docNo,
  periodLock = null,
}: {
  saleId: string;
  docNo: string;
  periodLock?: PeriodLockView | null;
}) => {
  const router = useRouter();
  return (
    <PeriodLockCancelButton
      periodLock={periodLock}
      docId={saleId}
      docNo={docNo}
      idFieldName="saleId"
      cancelAction={cancelSale}
      onSuccess={() => router.refresh()}
    />
  );
};

export default SaleCancelButton;
