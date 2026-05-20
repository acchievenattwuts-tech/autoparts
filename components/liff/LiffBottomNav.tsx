import Link from "next/link";
import { BadgeDollarSign, ReceiptText, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";

const navItems = [
  { href: "/liff/orders", label: "บิล", icon: ReceiptText },
  { href: "/liff/outstanding", label: "ชำระ", icon: BadgeDollarSign },
  { href: "/liff/warranties", label: "ประกัน", icon: ShieldCheck },
  { href: "/liff/claims", label: "เคลม", icon: ShieldAlert },
  { href: "/liff/profile", label: "ฉัน", icon: UserRound },
];

export default function LiffBottomNav({ active }: { active: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-blue-100 bg-white/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_34px_rgba(37,99,235,0.10)] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-950/95 dark:shadow-[0_-14px_34px_rgba(0,0,0,0.30)]">
      <div className="mx-auto grid max-w-md grid-cols-5 px-2 py-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = active === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition active:scale-[0.98] ${
                isActive ? "text-blue-900 dark:text-sky-300" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <span
                className={`inline-flex h-8 min-w-12 items-center justify-center rounded-full transition ${
                  isActive
                    ? "bg-[#e9f8f0] text-[#06c755] ring-1 ring-emerald-100 shadow-sm dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-900"
                    : "bg-transparent"
                }`}
              >
                <Icon size={18} />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
