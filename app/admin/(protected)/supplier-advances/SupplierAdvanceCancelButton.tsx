"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelSupplierAdvance } from "./actions";

export default function SupplierAdvanceCancelButton({
  advanceId,
  docNo,
  disabledReason,
}: {
  advanceId: string;
  docNo: string;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={advanceId}
      docNo={docNo}
      idFieldName="advanceId"
      cancelAction={cancelSupplierAdvance}
      disabledReason={disabledReason}
      description={`เอกสาร ${docNo} จะถูกยกเลิกและยอดจ่ายเงินจะถูกนำออกจาก Cash/Bank ไม่สามารถกู้คืนได้`}
      onSuccess={() => router.refresh()}
    />
  );
}
