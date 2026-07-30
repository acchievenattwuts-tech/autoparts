"use client";

import Link, { useLinkStatus } from "next/link";
import { LoaderCircle } from "lucide-react";

const tabs = [
  ["คลังความรู้", "/admin/knowledge"],
  ["รออนุมัติ", "/admin/knowledge/approval"],
  ["สถานะ Sync", "/admin/knowledge/sync"],
  ["ทดลองถาม AI", "/admin/knowledge/test"],
] as const;

function TabPendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 ${pending ? "animate-spin opacity-100" : "opacity-0"}`}
    />
  );
}

export default function KnowledgeTabs({
  active,
}: {
  active: "library" | "approval" | "sync" | "test";
}) {
  const activeIndex = { library: 0, approval: 1, sync: 2, test: 3 }[active];
  return (
    <nav className="mb-5 flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      {tabs.map(([label, href], index) => (
        <Link
          key={href}
          href={href}
          className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${index === activeIndex ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"}`}
        >
          <span>{label}</span>
          <TabPendingIndicator />
        </Link>
      ))}
    </nav>
  );
}
