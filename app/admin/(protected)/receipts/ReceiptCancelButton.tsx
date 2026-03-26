"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelReceipt } from "./actions";

const ReceiptCancelButton = ({ receiptId }: { receiptId: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={receiptId}
      idFieldName="receiptId"
      cancelAction={cancelReceipt}
      onSuccess={() => router.refresh()}
    />
  );
};

export default ReceiptCancelButton;
