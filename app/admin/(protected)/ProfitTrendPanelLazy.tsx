"use client";

import dynamic from "next/dynamic";

import { useOptionalAdminTheme } from "@/components/shared/AdminThemeProvider";

import type { ProfitTrendPanelProps } from "./ProfitTrendPanel";

function ChartSkeleton() {
  const adminTheme = useOptionalAdminTheme();
  const isDark = adminTheme?.isDark ?? false;

  return (
    <div
      className={`h-72 overflow-hidden rounded-2xl border animate-pulse ${
        isDark ? "border-slate-800/80 bg-slate-950/70" : "border-gray-100 bg-white"
      }`}
      aria-hidden="true"
    >
      <div className={`h-full w-full ${isDark ? "bg-slate-900/80" : "bg-gray-50"}`} />
    </div>
  );
}

const ProfitTrendPanel = dynamic(() => import("./ProfitTrendPanel"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export default function ProfitTrendPanelLazy(props: ProfitTrendPanelProps) {
  return <ProfitTrendPanel {...props} />;
}
