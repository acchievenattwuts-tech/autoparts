"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import {
  cancelCustomerAdvanceRefund,
  cancelSupplierAdvanceRefund,
} from "@/lib/advance-refund-actions";

export default function AdvanceRefundCancelButton({
  side,
  refundId,
  docNo,
}: {
  side: "CUSTOMER" | "SUPPLIER";
  refundId: string;
  docNo: string;
}) {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={refundId}
      docNo={docNo}
      idFieldName="refundId"
      cancelAction={
        side === "CUSTOMER"
          ? cancelCustomerAdvanceRefund
          : cancelSupplierAdvanceRefund
      }
      description={`เอกสาร ${docNo} จะถูกยกเลิก ยอดคงเหลือของเอกสารมัดจำต้นทางและยอด Cash/Bank จะถูกคำนวณใหม่`}
      onSuccess={() => router.refresh()}
    />
  );
}
