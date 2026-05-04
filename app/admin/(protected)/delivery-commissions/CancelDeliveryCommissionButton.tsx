"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cancelDeliveryCommissionRun } from "./actions";

type Props = {
  runId: string;
  cancelNote: string;
  redirectTo?: string;
  className?: string;
};

const CancelDeliveryCommissionButton = ({
  runId,
  cancelNote,
  redirectTo,
  className,
}: Props) => {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setError("");
          startTransition(async () => {
            const formData = new FormData();
            formData.set("runId", runId);
            formData.set("cancelNote", cancelNote);
            const result = await cancelDeliveryCommissionRun(formData);
            if (result?.error) {
              setError(result.error);
              return;
            }
            if (redirectTo) {
              router.push(redirectTo);
            } else {
              router.refresh();
            }
            router.refresh();
          });
        }}
        disabled={isPending}
        className={className}
      >
        {isPending ? "กำลังยกเลิก..." : "ยกเลิกเอกสาร"}
      </button>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
      ) : null}
    </div>
  );
};

export default CancelDeliveryCommissionButton;
