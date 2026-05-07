import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  colorScheme: "light",
  themeColor: "#ffffff",
  robots: { index: false, follow: false },
};

export default function LiffPrintLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-liff-print="true"
      className="min-h-dvh bg-white text-slate-950"
      style={{ colorScheme: "only light", backgroundColor: "#ffffff" }}
    >
      {children}
    </div>
  );
}
