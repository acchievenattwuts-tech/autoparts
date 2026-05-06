"use client";

import { useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

type WarrantyStatusTab = {
  key: string;
  label: string;
  href: string;
};

export default function LiffWarrantyStatusTabs({
  tabs,
  activeKey,
}: {
  tabs: readonly WarrantyStatusTab[];
  activeKey: string;
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const loadingTab = tabs.find((tab) => tab.key === pendingKey);

  function handleTabClick(tab: WarrantyStatusTab) {
    if (tab.key === activeKey || isPending) return;
    setPendingKey(tab.key);
    startTransition(() => {
      router.push(tab.href);
    });
  }

  return (
    <div
      className="relative grid grid-cols-3 gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-1 text-xs font-bold"
      aria-busy={isPending}
    >
      {tabs.map((tab) => {
        const isActive = activeKey === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabClick(tab)}
            disabled={isPending && !isActive}
            className={`flex min-h-9 items-center justify-center gap-1 rounded-md px-2 py-2 text-center transition ${
              isActive ? "bg-white text-blue-800 shadow-sm" : "text-slate-500"
            } ${isPending ? "cursor-wait" : ""}`}
          >
            {isPending && pendingKey === tab.key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            <span>{tab.label}</span>
          </button>
        );
      })}
      {isPending ? (
        <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-blue-500/70" />
      ) : null}
      <span className="sr-only">
        {isPending ? `กำลังโหลดรายการ${loadingTab?.label ?? ""}` : ""}
      </span>
    </div>
  );
}
