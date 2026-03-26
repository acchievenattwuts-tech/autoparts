"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelReceipt } from "./actions";

const ReceiptCancelButton = ({ receiptId, docNo }: { receiptId: string; docNo: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={receiptId}
      docNo={docNo}
      idFieldName="receiptId"
      cancelAction={cancelReceipt}
      onSuccess={() => router.refresh()}
    />
  );
};

export default ReceiptCancelButton;
