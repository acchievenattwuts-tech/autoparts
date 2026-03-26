"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelPurchase } from "./actions";

const PurchaseCancelButton = ({ purchaseId }: { purchaseId: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={purchaseId}
      idFieldName="purchaseId"
      cancelAction={cancelPurchase}
      onSuccess={() => router.refresh()}
    />
  );
};

export default PurchaseCancelButton;
