"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelPurchase } from "./actions";

const PurchaseCancelButton = ({ purchaseId, docNo }: { purchaseId: string; docNo: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={purchaseId}
      docNo={docNo}
      idFieldName="purchaseId"
      cancelAction={cancelPurchase}
      onSuccess={() => router.refresh()}
    />
  );
};

export default PurchaseCancelButton;
