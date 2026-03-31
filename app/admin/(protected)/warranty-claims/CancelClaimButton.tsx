"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelClaimAction } from "./actions";

const CancelClaimButton = ({ claimId, claimNo }: { claimId: string; claimNo: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={claimId}
      docNo={claimNo}
      idFieldName="claimId"
      cancelAction={cancelClaimAction}
      onSuccess={() => router.refresh()}
    />
  );
};

export default CancelClaimButton;
