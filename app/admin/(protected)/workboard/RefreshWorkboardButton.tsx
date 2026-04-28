"use client";

import { useTransition } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

const RefreshWorkboardButton = () => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163052] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
    >
      {isPending ? (
        <>
          กำลังรีเฟรช
          <LoaderCircle size={16} className="animate-spin" />
        </>
      ) : (
        <>
          รีเฟรช
          <ArrowRight size={16} />
        </>
      )}
    </button>
  );
};

export default RefreshWorkboardButton;
