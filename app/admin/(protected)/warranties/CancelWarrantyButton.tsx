"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelWarranty } from "./actions";

const CancelWarrantyButton = ({
  warrantyId,
  warrantyLabel,
}: {
  warrantyId: string;
  warrantyLabel: string;
}) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={warrantyId}
      docNo={warrantyLabel}
      idFieldName="warrantyId"
      cancelAction={cancelWarranty}
      onSuccess={() => router.refresh()}
    />
  );
};

export default CancelWarrantyButton;
