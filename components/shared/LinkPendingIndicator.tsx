"use client";

import { LoaderCircle } from "lucide-react";
import { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

type LinkPendingIndicatorProps = {
  className?: string;
  label?: string;
  variant?: "icon" | "chip";
};

const LinkPendingIndicator = ({
  className,
  label = "กำลังโหลด",
  variant = "icon",
}: LinkPendingIndicatorProps) => {
  const { pending } = useLinkStatus();

  if (variant === "chip") {
    return (
      <span
        aria-hidden={!pending}
        className={cn(
          "pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-[#1e3a5f]/10 bg-white/95 px-2 py-1 text-[11px] font-medium text-[#1e3a5f] shadow-sm transition-all dark:border-white/10 dark:bg-slate-950/90 dark:text-sky-200",
          pending ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          className,
        )}
      >
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      aria-hidden={!pending}
      className={cn(
        "pointer-events-none ml-auto inline-flex h-4 w-4 items-center justify-center text-current transition-opacity",
        pending ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
    </span>
  );
};

export default LinkPendingIndicator;
