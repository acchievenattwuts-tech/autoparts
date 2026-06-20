"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import LiffBottomNav, { LIFF_BOTTOM_NAV_ITEMS } from "@/components/liff/LiffBottomNav";

function getActiveBottomNav(pathname: string) {
  return LIFF_BOTTOM_NAV_ITEMS.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href ?? null;
}

export default function LiffAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const activeBottomNav = getActiveBottomNav(pathname);

  return (
    <>
      <div key={pathname} className="liff-page-transition">
        {children}
      </div>
      {activeBottomNav ? <LiffBottomNav active={activeBottomNav} /> : null}
    </>
  );
}
