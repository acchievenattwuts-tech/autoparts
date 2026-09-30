"use client";

import { useRouter } from "next/navigation";
import { PeriodLockCancelButton } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelCreditNote } from "./actions";

const CreditNoteCancelButton = ({
  cnId,
  docNo,
  periodLock = null,
}: {
  cnId: string;
  docNo: string;
  periodLock?: PeriodLockView | null;
}) => {
  const router = useRouter();
  return (
    <PeriodLockCancelButton
      periodLock={periodLock}
      docId={cnId}
      docNo={docNo}
      idFieldName="cnId"
      cancelAction={cancelCreditNote}
      onSuccess={() => router.refresh()}
    />
  );
};

export default CreditNoteCancelButton;
