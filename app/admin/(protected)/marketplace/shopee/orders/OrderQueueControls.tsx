"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";

import { pullOrdersNowAction } from "./actions";

const OrderQueueControls = ({ shopRecordId }: { shopRecordId: string }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const handlePull = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await pullOrdersNowAction(shopRecordId);
      if (res.ok) {
        const { fetched, created, needsMapping } = res.result;
        setMessage({
          kind: "ok",
          text: `ดึง ${fetched} ออเดอร์ · ใหม่ ${created} · ต้อง map SKU ${needsMapping}`,
        });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handlePull}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50 dark:bg-orange-500 dark:hover:bg-orange-400"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        ดึงออเดอร์จาก Shopee
      </button>
      {message ? (
        <span
          className={
            message.kind === "ok"
              ? "text-sm text-emerald-700 dark:text-emerald-300"
              : "text-sm text-rose-600 dark:text-rose-300"
          }
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
};

export default OrderQueueControls;
