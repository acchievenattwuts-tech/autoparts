"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelCreditNote } from "./actions";

const CreditNoteCancelButton = ({ cnId }: { cnId: string }) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={cnId}
      idFieldName="cnId"
      cancelAction={cancelCreditNote}
      onSuccess={() => router.refresh()}
    />
  );
};

export default CreditNoteCancelButton;
