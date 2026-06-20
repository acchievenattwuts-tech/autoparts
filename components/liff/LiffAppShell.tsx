"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import LiffBottomNav, { LIFF_BOTTOM_NAV_ITEMS } from "@/components/liff/LiffBottomNav";

function getActiveBottomNav(pathname: string) {
  return LIFF_BOTTOM_NAV_ITEMS.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href ?? null;
}

export default function LiffAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const activeBottomNav = getActiveBottomNav(pathname);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The document itself never scrolls in the LIFF app-shell (see globals.css +
  // LiffThemeProvider), so page navigation cannot rely on the browser resetting
  // window scroll. Reset the inner scroll region to the top on every route change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <>
      <div ref={scrollRef} className="liff-scroll-region">
        <div key={pathname} className="liff-page-transition">
          {children}
        </div>
      </div>
      {activeBottomNav ? <LiffBottomNav active={activeBottomNav} /> : null}
    </>
  );
}
