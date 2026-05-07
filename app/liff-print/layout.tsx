import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import LiffPrintLightTheme from "@/components/liff/LiffPrintLightTheme";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LiffPrintLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        :root, html, body {
          background-color: #ffffff !important;
          background-image: linear-gradient(#ffffff, #ffffff) !important;
          color: #111827 !important;
          color-scheme: light only !important;
          forced-color-adjust: none !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        html.dark, body.dark, .dark {
          background-color: #ffffff !important;
          background-image: linear-gradient(#ffffff, #ffffff) !important;
          color: #111827 !important;
          color-scheme: light only !important;
        }
        body * {
          color-scheme: light only !important;
          forced-color-adjust: none !important;
        }
      `}</style>
      <LiffPrintLightTheme />
      <div
        data-liff-print="true"
        className="min-h-dvh bg-white text-slate-950"
        style={{ colorScheme: "light only", backgroundColor: "#ffffff", color: "#111827" }}
      >
        {children}
      </div>
    </>
  );
}
