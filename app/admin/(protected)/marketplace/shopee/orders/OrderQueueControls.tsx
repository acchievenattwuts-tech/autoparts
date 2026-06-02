"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Loader2, Truck } from "lucide-react";

import { pullOrdersNowAction, scanReturnReviewsAction, syncLogisticsFromOrdersAction } from "./actions";

const OrderQueueControls = ({ shopRecordId }: { shopRecordId: string }) => {
  const router = useRouter();
  const [isPullPending, startPullTransition] = useTransition();
  const [isLogisticsPending, startLogisticsTransition] = useTransition();
  const [isReturnReviewPending, startReturnReviewTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const handlePull = () => {
    setMessage(null);
    startPullTransition(async () => {
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

  const handleLogisticsSync = () => {
    setMessage(null);
    startLogisticsTransition(async () => {
      const res = await syncLogisticsFromOrdersAction(shopRecordId);
      if (res.ok) {
        const { scanned, updated, withTracking } = res.result;
        setMessage({
          kind: "ok",
          text: `sync tracking ${updated}/${scanned} รายการ · พบ tracking ${withTracking}`,
        });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  };

  const handleReturnReviewScan = () => {
    setMessage(null);
    startReturnReviewTransition(async () => {
      const res = await scanReturnReviewsAction(shopRecordId);
      if (res.ok) {
        const { scanned, flagged, alreadyReview } = res.result;
        setMessage({
          kind: "ok",
          text: `scan review ${scanned} รายการ · เข้า review ใหม่ ${flagged} · อยู่แล้ว ${alreadyReview}`,
        });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  };

  const isPending = isPullPending || isLogisticsPending || isReturnReviewPending;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handlePull}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50 dark:bg-orange-500 dark:hover:bg-orange-400"
      >
        {isPullPending ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        ดึงออเดอร์จาก Shopee
      </button>
      <button
        type="button"
        onClick={handleLogisticsSync}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
      >
        {isLogisticsPending ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
        sync tracking
      </button>
      <button
        type="button"
        onClick={handleReturnReviewScan}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 shadow-sm transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100 dark:hover:bg-amber-400/20"
      >
        {isReturnReviewPending ? <Loader2 size={16} className="animate-spin" /> : <AlertTriangle size={16} />}
        scan cancel/refund
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
