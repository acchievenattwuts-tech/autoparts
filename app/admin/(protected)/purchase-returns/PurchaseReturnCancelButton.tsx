"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelPurchaseReturn } from "./actions";

const PurchaseReturnCancelButton = ({ returnId, docNo }: { returnId: string; docNo: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={returnId}
      docNo={docNo}
      idFieldName="returnId"
      cancelAction={cancelPurchaseReturn}
      onSuccess={() => router.refresh()}
    />
  );
};

export default PurchaseReturnCancelButton;
