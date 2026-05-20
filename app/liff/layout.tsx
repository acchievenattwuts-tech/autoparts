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
        <div className="liff-app-shell min-h-dvh bg-[radial-gradient(circle_at_top,#dff4ff_0,#f8fbff_42%,#eef7ff_100%)] text-slate-950 transition-colors dark:bg-none dark:bg-slate-950 dark:text-slate-100">
          <div className="liff-app-frame mx-auto min-h-dvh w-full max-w-md bg-[linear-gradient(180deg,#ffffff_0%,#f3fbff_36%,#ffffff_100%)] shadow-2xl shadow-blue-950/10 transition-colors dark:bg-none dark:bg-slate-950 dark:shadow-none">
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
