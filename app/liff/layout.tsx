import type { Metadata } from "next";
import type { ReactNode } from "react";

import ContactShopButton from "@/components/liff/ContactShopButton";
import LiffGate from "@/components/liff/LiffGate";
import LiffProvider from "@/components/liff/LiffProvider";
import LiffThemeProvider from "@/components/liff/LiffThemeProvider";
import WelcomeScreen from "@/components/liff/WelcomeScreen";

export const metadata: Metadata = {
  title: "บริการลูกค้า LINE | ศรีวรรณ อะไหล่แอร์",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LiffLayout({ children }: { children: ReactNode }) {
  return (
    <LiffThemeProvider>
      <LiffProvider>
        <div className="liff-app-shell min-h-dvh bg-[#f5f7f4] text-slate-950 transition-colors">
          <div className="liff-app-frame mx-auto min-h-dvh w-full max-w-md bg-[#f8faf7] shadow-2xl shadow-slate-950/5 transition-colors">
            <LiffGate>
              <WelcomeScreen />
              {children}
            </LiffGate>
          </div>
          <ContactShopButton />
        </div>
      </LiffProvider>
    </LiffThemeProvider>
  );
}
