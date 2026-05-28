import type { Metadata } from "next";
import type { ReactNode } from "react";

import ContactShopButton from "@/components/liff/ContactShopButton";
import LiffGate from "@/components/liff/LiffGate";
import LiffProvider from "@/components/liff/LiffProvider";
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

const liffThemeBootstrapScript = `
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var isPrint = params.has("printToken");
    var theme = isPrint ? "light" : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var root = document.documentElement;
    var body = document.body;
    root.dataset.liffTheme = theme;
    root.style.colorScheme = isPrint ? "only light" : theme;
    root.classList.toggle("dark", theme === "dark");
    if (body) {
      body.dataset.liffTheme = theme;
      body.style.colorScheme = isPrint ? "only light" : theme;
      body.style.backgroundColor = isPrint ? "#ffffff" : (theme === "dark" ? "#06162d" : "#eef7ff");
      body.classList.toggle("dark", theme === "dark");
    }
  } catch (error) {}
})();
`;

export default async function LiffLayout({ children }: { children: ReactNode }) {
  const config = await getPublicSiteConfig();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: liffThemeBootstrapScript }} />
      <LiffThemeProvider>
        <LiffProvider>
          <div className="liff-app-shell min-h-dvh bg-[radial-gradient(circle_at_top,#dff4ff_0,#f8fbff_42%,#eef7ff_100%)] text-slate-950 transition-colors dark:bg-none dark:bg-slate-950 dark:text-slate-100">
            <div className="liff-app-frame mx-auto min-h-dvh w-full max-w-md bg-[linear-gradient(180deg,#ffffff_0%,#f3fbff_36%,#ffffff_100%)] shadow-2xl shadow-blue-950/10 transition-colors dark:bg-none dark:bg-slate-950 dark:shadow-none">
              <LiffGate lineUrl={config.shopLineUrl}>
                <WelcomeScreen />
                {children}
              </LiffGate>
            </div>
            <ContactShopButton lineUrl={config.shopLineUrl} />
          </div>
        </LiffProvider>
      </LiffThemeProvider>
    </>
  );
}
