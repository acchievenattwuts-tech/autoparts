"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelProfitDistribution } from "./actions";

type Props = {
  distributionId: string;
};

const CancelDistributionButton = ({ distributionId }: Props) => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-10 items-center rounded-xl border border-rose-200 px-4 text-sm font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
      >
        ยกเลิกเอกสาร
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-400/20 dark:bg-rose-500/10">
      <p className="text-sm font-medium text-rose-800 dark:text-rose-100">
        ยกเลิกเอกสารนี้? เงินที่ตัดจากบัญชีจะถูกคืน และงวดนี้จะกลับมาประกาศใหม่ได้
      </p>
      <input
        type="text"
        value={cancelNote}
        maxLength={200}
        onChange={(event) => setCancelNote(event.target.value)}
        placeholder="เหตุผลในการยกเลิก (ไม่บังคับ)"
        className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-rose-400 dark:border-rose-400/30 dark:bg-slate-900 dark:text-slate-100"
      />
      {error ? <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError("");
            startTransition(async () => {
              const formData = new FormData();
              formData.set("distributionId", distributionId);
              formData.set("cancelNote", cancelNote);
              const result = await cancelProfitDistribution(formData);
              if (result?.error) {
                setError(result.error);
                return;
              }
              setIsOpen(false);
              router.refresh();
            });
          }}
          className="inline-flex h-9 items-center rounded-lg bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
        >
          {isPending ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError("");
          }}
          className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
        >
          ไม่ยกเลิก
        </button>
      </div>
    </div>
  );
};

export default CancelDistributionButton;
