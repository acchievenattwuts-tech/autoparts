import Image from "next/image";
import Link from "next/link";
import { Phone } from "lucide-react";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import StorefrontHeaderMobileNav from "@/components/storefront/StorefrontHeaderMobileNav";
import StorefrontHeaderSearch from "@/components/storefront/StorefrontHeaderSearch";
import { STOREFRONT_NAV_LINKS } from "@/lib/storefront-nav";
import { STOREFRONT_HEADER_BAR_CLASS } from "@/lib/storefront-home-theme";

const LINE_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
  </svg>
);

interface Props {
  shopName: string;
  shopSlogan: string;
  shopLogoUrl: string;
  shopPhone: string;
  lineUrl: string;
  /** Keeps the current query in the search box on result pages. */
  searchQuery?: string;
}

const StorefrontHeader = ({
  shopName,
  shopSlogan,
  shopLogoUrl,
  shopPhone,
  lineUrl,
  searchQuery,
}: Props) => {
  const displayPhone = shopPhone ? shopPhone.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") : "";
  const shopLogoSrc = toPublicStorageCdnPath(shopLogoUrl) ?? shopLogoUrl;

  return (
    <header className={`sticky top-0 z-50 ${STOREFRONT_HEADER_BAR_CLASS} text-white`}>
      {/* Utility strip — desktop only, but on every page: it now carries the
          section nav, so hiding it would leave content pages with no internal
          links in the header at all. */}
      <div className="hidden border-b border-white/10 lg:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-1.5 text-xs sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-5">
            <p className="truncate text-white/70">{shopSlogan}</p>
            {/* Section nav — keeps its own 14px, the size it had as its own row */}
            <nav className="flex shrink-0 items-center gap-5 text-sm">
              {STOREFRONT_NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="whitespace-nowrap font-medium text-white/80 transition-colors hover:text-white"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {displayPhone && (
              <a
                href={`tel:${shopPhone}`}
                className="flex min-h-[24px] items-center gap-1.5 text-white/80 transition-colors hover:text-white"
              >
                <Phone className="h-3.5 w-3.5" />
                {displayPhone}
              </a>
            )}
            {lineUrl && (
              <a
                href={lineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[24px] items-center gap-1.5 text-white/80 transition-colors hover:text-white"
              >
                {LINE_ICON}
                สอบถามทาง LINE
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Main bar — logo + search + LINE CTA */}
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 sm:gap-5">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden">
              {shopLogoUrl ? (
                <Image
                  src={shopLogoSrc}
                  alt={`${shopName} logo`}
                  fill
                  sizes="40px"
                  className="object-contain"
                  priority
                />
              ) : (
                <span className="text-sm font-bold text-[#1e3a5f]">ศว</span>
              )}
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block font-kanit text-base font-bold">{shopName}</span>
              <span className="block text-[11px] text-white/70">อะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์</span>
            </span>
          </Link>

          <StorefrontHeaderSearch searchQuery={searchQuery} />

          {/* Below lg the nav row and LINE pill collapse into these two */}
          <StorefrontHeaderMobileNav lineUrl={lineUrl} shopPhone={shopPhone} />

          {lineUrl && (
            <a
              href={lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#e6eefa] lg:inline-flex"
            >
              {LINE_ICON}
              สั่งซื้อผ่าน LINE
            </a>
          )}
        </div>

      </div>
    </header>
  );
};

export default StorefrontHeader;
