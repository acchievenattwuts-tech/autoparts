"use client";

import Image from "next/image";
import { useState } from "react";
import { Menu, X, Phone, Search } from "lucide-react";

const LINE_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-white">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
  </svg>
);

const navLinks = [
  { label: "หน้าแรก", href: "/#home" },
  { label: "สินค้า", href: "/products" },
  { label: "เกี่ยวกับร้าน", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "คลังความรู้", href: "/knowledge" },
  { label: "ติดต่อ", href: "/#contact" },
];

interface NavbarProps {
  shopName?: string;
  shopSlogan?: string;
  shopLogoUrl?: string;
  lineUrl?: string;
  shopPhone?: string;
  searchQuery?: string;
}

const Navbar = ({
  shopName = "ศรีวรรณ อะไหล่แอร์",
  shopLogoUrl = "",
  lineUrl = "https://lin.ee/18P0SqG",
  shopPhone,
  searchQuery,
}: NavbarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const nameParts = shopName.split(" ");
  const firstName = nameParts[0] ?? shopName;
  const restName = nameParts.slice(1).join(" ");
  const displayPhone = shopPhone?.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") ?? null;

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <a href="/" className="flex shrink-0 items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] border border-[#1e3a5f]/10 bg-white shadow-sm">
              {shopLogoUrl ? (
                <div className="relative h-8 w-8">
                  <Image
                    src={shopLogoUrl}
                    alt={`${shopName} logo`}
                    fill
                    sizes="32px"
                    className="object-contain"
                  />
                </div>
              ) : (
                <span className="text-sm font-bold text-[#1e3a5f]">ศว</span>
              )}
            </div>
            <div className="hidden leading-tight sm:block">
              <p className="text-sm font-bold leading-none text-[#1e3a5f]">{firstName}</p>
              <p className="text-xs font-medium text-[#f97316]">{restName}</p>
            </div>
          </a>

          <nav className="hidden items-center gap-5 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="whitespace-nowrap text-sm font-medium text-gray-600 transition-colors hover:text-[#1e3a5f]"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <form action="/products" method="GET" className="hidden max-w-sm flex-1 items-center md:flex">
            <div className="relative w-full">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                name="q"
                defaultValue={searchQuery ?? ""}
                placeholder="ค้นหาสินค้า ยี่ห้อรถ รุ่นรถ..."
                className="w-full rounded-full border-2 border-gray-200 bg-white py-2 pl-8 pr-10 text-sm shadow-sm transition-colors hover:border-[#1e3a5f]/40 focus:border-[#1e3a5f] focus:outline-none"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-[#f97316] p-1.5 text-white transition-colors hover:bg-[#ea6c0a]"
              >
                <Search size={11} />
              </button>
            </div>
          </form>

          <div className="hidden shrink-0 items-center gap-3 md:flex">
            {displayPhone && (
              <a
                href={`tel:${shopPhone}`}
                className="flex items-center gap-1.5 text-sm text-gray-600 transition-colors hover:text-[#1e3a5f]"
              >
                <Phone className="h-4 w-4" />
                <span>{displayPhone}</span>
              </a>
            )}
            <a
              href={lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-full bg-[#06C755] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#05a847]"
            >
              {LINE_ICON}
              LINE
            </a>
          </div>

          <button
            onClick={() => setIsOpen((prev) => !prev)}
            className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 md:hidden"
            aria-label="เปิด/ปิดเมนู"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-gray-100 bg-white px-4 pb-4 md:hidden">
          <form action="/products" method="GET" className="pb-2 pt-3">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                name="q"
                defaultValue={searchQuery ?? ""}
                placeholder="ค้นหาสินค้า ยี่ห้อรถ รุ่นรถ..."
                className="w-full rounded-full border-2 border-gray-200 bg-white py-2 pl-8 pr-10 text-sm focus:border-[#1e3a5f] focus:outline-none"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-[#f97316] p-1.5 text-white transition-colors hover:bg-[#ea6c0a]"
              >
                <Search size={11} />
              </button>
            </div>
          </form>

          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-[#1e3a5f]"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <a
            href={lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-2 rounded-full bg-[#06C755] px-4 py-3 text-sm font-semibold text-white transition-colors"
          >
            {LINE_ICON}
            สั่งซื้อผ่าน LINE OA
          </a>
        </div>
      )}
    </header>
  );
};

export default Navbar;
