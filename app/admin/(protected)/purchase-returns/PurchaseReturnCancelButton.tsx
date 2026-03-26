"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelPurchaseReturn } from "./actions";

const PurchaseReturnCancelButton = ({ returnId }: { returnId: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={returnId}
      idFieldName="returnId"
      cancelAction={cancelPurchaseReturn}
      onSuccess={() => router.refresh()}
    />
  );
};

export default PurchaseReturnCancelButton;
