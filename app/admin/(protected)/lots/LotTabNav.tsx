"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Lot Balance", href: "/admin/lots/balance" },
  { label: "ใกล้หมดอายุ", href: "/admin/lots/expiry" },
  { label: "Lot Trace", href: "/admin/lots/trace" },
  { label: "Slow Moving", href: "/admin/lots/slow-moving" },
];

export default function LotTabNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-0 border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            pathname.startsWith(tab.href)
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
