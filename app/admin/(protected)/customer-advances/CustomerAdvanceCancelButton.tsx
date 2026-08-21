"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelCustomerAdvance } from "./actions";

export default function CustomerAdvanceCancelButton({ advanceId, docNo, disabledReason }: { advanceId: string; docNo: string; disabledReason?: string | null }) {
  const router = useRouter();
  return <CancelDocButton docId={advanceId} docNo={docNo} idFieldName="advanceId" cancelAction={cancelCustomerAdvance} disabledReason={disabledReason} description={`เอกสาร ${docNo} จะถูกยกเลิกและยอดรับเงินจะถูกนำออกจากบัญชี Cash/Bank ไม่สามารถกู้คืนได้`} onSuccess={() => router.refresh()} />;
}
