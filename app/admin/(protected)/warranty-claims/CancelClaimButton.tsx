"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelClaimAction } from "./actions";

const CancelClaimButton = ({
  claimId,
  claimNo,
  disabledReason,
}: {
  claimId: string;
  claimNo: string;
  disabledReason?: string | null;
}) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={claimId}
      docNo={claimNo}
      idFieldName="claimId"
      cancelAction={cancelClaimAction}
      onSuccess={() => router.refresh()}
      disabledReason={disabledReason}
    />
  );
};

export default CancelClaimButton;
