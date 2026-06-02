"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ReceiptText } from "lucide-react";

import { createSaleFromOrderAction } from "../actions";

const CreateSaleConfirm = ({ orderImportId }: { orderImportId: string }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await createSaleFromOrderAction(orderImportId);
      if (res.ok) {
        router.push(`/admin/sales/${res.saleId}`);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleConfirm}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
        ยืนยันสร้างบิลขาย
      </button>
      {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
};

export default CreateSaleConfirm;
