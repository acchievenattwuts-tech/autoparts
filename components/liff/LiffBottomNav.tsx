import Link from "next/link";
import { BadgeDollarSign, PackageSearch, ReceiptText, ShieldCheck, UserRound } from "lucide-react";

const navItems = [
  { href: "/liff/orders", label: "บิล", icon: ReceiptText },
  { href: "/liff/outstanding", label: "ค้าง", icon: BadgeDollarSign },
  { href: "/liff/products", label: "สินค้า", icon: PackageSearch },
  { href: "/liff/warranties", label: "ประกัน", icon: ShieldCheck },
  { href: "/liff/profile", label: "ข้อมูล", icon: UserRound },
];

export default function LiffBottomNav({ active }: { active: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = active === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold ${
                isActive ? "text-teal-700" : "text-slate-500"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
