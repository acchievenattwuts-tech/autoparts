"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelSale } from "./actions";

const SaleCancelButton = ({ saleId, docNo }: { saleId: string; docNo: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={saleId}
      docNo={docNo}
      idFieldName="saleId"
      cancelAction={cancelSale}
      onSuccess={() => router.refresh()}
    />
  );
};

export default SaleCancelButton;
