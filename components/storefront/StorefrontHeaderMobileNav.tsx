"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Menu, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import StorefrontFilterTrigger from "@/components/shared/StorefrontFilterTrigger";
import { STOREFRONT_NAV_LINKS } from "@/lib/storefront-nav";

const LINE_ICON = (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current" aria-hidden="true">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
  </svg>
);

const ICON_BUTTON_CLASS =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

interface Props {
  lineUrl: string;
  shopPhone: string;
}

/**
 * Compact header controls for phones and tablets.
 *
 * Below lg the header has no room for the section nav or the LINE pill, so they
 * collapse into two icon buttons: the shared product filter, and a drawer
 * holding the section links plus contact details.
 */
const StorefrontHeaderMobileNav = ({ lineUrl, shopPhone }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-2 lg:hidden">
      {/* The storefront-wide trigger, restyled for the blue bar. It keeps the
          behaviour a local copy would lose: on /products it opens that page's
          own drawer with the filters already applied instead of resetting them,
          it shows how many are active, and it fetches the filter lists only
          when first opened rather than shipping them with every page. */}
      <StorefrontFilterTrigger
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden"
        badgeClassName="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-bold text-[#1e3a5f] shadow-sm"
      />

      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="เปิดเมนู"
        className={ICON_BUTTON_CLASS}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Section links + contact */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="bg-white p-0">
          <SheetHeader className="border-b border-[#eef3fa] px-5 py-4">
            <SheetTitle className="font-kanit text-base font-bold text-[#1e3a5f]">เมนู</SheetTitle>
          </SheetHeader>

          <nav className="flex flex-col px-2 py-2">
            {STOREFRONT_NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-[#f6f9fe] hover:text-[#1e3a5f]"
              >
                {link.label}
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </Link>
            ))}
          </nav>

          <div className="mt-auto border-t border-[#eef3fa] px-5 py-4">
            <p className="mb-2.5 text-xs font-semibold text-slate-400">ติดต่อร้าน</p>
            <div className="flex flex-col gap-2">
              {lineUrl && (
                <a
                  href={lineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-xl bg-[#06C755] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#05a847]"
                >
                  {LINE_ICON}
                  สอบถามทาง LINE
                </a>
              )}
              {shopPhone && (
                <a
                  href={`tel:${shopPhone}`}
                  className="flex items-center gap-2.5 rounded-xl bg-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#163055]"
                >
                  <Phone className="h-5 w-5 shrink-0" />
                  โทร {shopPhone}
                </a>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default StorefrontHeaderMobileNav;
