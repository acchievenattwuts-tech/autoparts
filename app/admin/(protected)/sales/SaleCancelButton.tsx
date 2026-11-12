"use client";

import { PeriodLockCancelButton } from "@/app/admin/_components/PeriodLockControls";
import type { PeriodLockView } from "@/lib/period-lock-view";
import { cancelSale } from "./actions";

// No router.refresh() on success: cancelSale calls revalidatePath on its only success path,
// so the action response already carries the re-rendered page.
const SaleCancelButton = ({
  saleId,
  docNo,
  periodLock = null,
}: {
  saleId: string;
  docNo: string;
  periodLock?: PeriodLockView | null;
}) => (
  <PeriodLockCancelButton
    periodLock={periodLock}
    docId={saleId}
    docNo={docNo}
    idFieldName="saleId"
    cancelAction={cancelSale}
  />
);

export default SaleCancelButton;
