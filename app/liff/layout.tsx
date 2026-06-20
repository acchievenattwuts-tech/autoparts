import type { Metadata } from "next";
import type { ReactNode } from "react";

import ContactShopButton from "@/components/liff/ContactShopButton";
import LiffAppShell from "@/components/liff/LiffAppShell";
import LiffGate from "@/components/liff/LiffGate";
import LiffProvider from "@/components/liff/LiffProvider";
import LiffThemeBootstrap from "@/components/liff/LiffThemeBootstrap";
import LiffThemeProvider from "@/components/liff/LiffThemeProvider";
import WelcomeScreen from "@/components/liff/WelcomeScreen";
import { getPublicSiteConfig } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublicSiteConfig();
  return {
    title: `บริการลูกค้า LINE | ${config.shopName}`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function LiffLayout({ children }: { children: ReactNode }) {
  const config = await getPublicSiteConfig();
  return (
    <>
      <LiffThemeBootstrap />
      <LiffThemeProvider>
        <LiffProvider>
          <div className="liff-app-shell min-h-dvh bg-[radial-gradient(circle_at_top,#dff4ff_0,#f8fbff_42%,#eef7ff_100%)] text-slate-950 transition-colors dark:bg-none dark:bg-slate-950 dark:text-slate-100">
            <div className="liff-app-frame mx-auto min-h-dvh w-full max-w-md bg-[linear-gradient(180deg,#ffffff_0%,#f3fbff_36%,#ffffff_100%)] shadow-2xl shadow-blue-950/10 transition-colors dark:bg-none dark:bg-slate-950 dark:shadow-none">
              <LiffGate lineUrl={config.shopLineUrl}>
                <WelcomeScreen />
                <LiffAppShell>{children}</LiffAppShell>
              </LiffGate>
            </div>
            <ContactShopButton lineUrl={config.shopLineUrl} />
          </div>
        </LiffProvider>
      </LiffThemeProvider>
    </>
  );
}
