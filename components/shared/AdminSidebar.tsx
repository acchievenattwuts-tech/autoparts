"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Car,
  Tags,
  Truck,
  ShoppingCart,
  TrendingUp,
  ShieldCheck,
  Receipt,
  BarChart3,
  Settings,
  X,
  Award,
  Archive,
  RefreshCw,
  FileX,
  RotateCcw,
  ClipboardList,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    label: "สินค้า",
    href: "/admin/products",
    icon: Package,
  },
  {
    section: "ข้อมูลหลัก",
    items: [
      { label: "หมวดหมู่สินค้า", href: "/admin/master/categories", icon: Tags },
      { label: "แบรนด์อะไหล่", href: "/admin/master/parts-brands", icon: Award },
      { label: "ยี่ห้อ / รุ่นรถ", href: "/admin/master/car-brands", icon: Car },
      { label: "ซัพพลายเออร์", href: "/admin/master/suppliers", icon: Truck },
    ],
  },
  {
    section: "สต็อก",
    items: [
      { label: "ยอดยกมา (BF)", href: "/admin/stock/bf", icon: Archive },
      { label: "ปรับสต็อก", href: "/admin/stock/adjustments", icon: RefreshCw },
      { label: "Stock Card MAVG", href: "/admin/stock/card", icon: ClipboardList },
    ],
  },
  {
    section: "ระบบงาน",
    items: [
      { label: "ลูกค้า", href: "/admin/customers", icon: Users },
      { label: "ซื้อสินค้าเข้า", href: "/admin/purchases", icon: ShoppingCart },
      { label: "คืนสินค้าซัพพลายเออร์", href: "/admin/purchase-returns", icon: RotateCcw },
      { label: "บันทึกการขาย", href: "/admin/sales", icon: TrendingUp },
      { label: "Credit Note (CN)", href: "/admin/credit-notes", icon: FileX },
      { label: "ประกันสินค้า", href: "/admin/warranties", icon: ShieldCheck },
      { label: "ค่าใช้จ่าย", href: "/admin/expenses", icon: Receipt },
    ],
  },
  {
    section: "รายงาน",
    items: [
      { label: "รายงาน", href: "/admin/reports", icon: BarChart3 },
    ],
  },
  {
    section: "ระบบ",
    items: [
      { label: "ตั้งค่าร้านค้า", href: "/admin/settings/company", icon: Settings },
    ],
  },
];

interface AdminSidebarProps {
  onClose?: () => void;
}

const AdminSidebar = ({ onClose }: AdminSidebarProps) => {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="flex flex-col h-full bg-[#1e3a5f] text-white w-64">
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div>
          <p className="font-kanit font-bold text-lg leading-tight">ศรีวรรณ อะไหล่แอร์</p>
          <p className="text-xs text-blue-200">ระบบจัดการหลังบ้าน</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden p-1 hover:bg-white/10 rounded">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item, idx) => {
          if ("section" in item) {
            return (
              <div key={idx} className="pt-3">
                <p className="px-3 py-1 text-xs font-semibold text-blue-300 uppercase tracking-wider">
                  {item.section}
                </p>
                {item.items?.map((sub) => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                      isActive(sub.href)
                        ? "bg-[#f97316] text-white font-medium"
                        : "text-blue-100 hover:bg-white/10"
                    )}
                  >
                    <sub.icon size={18} />
                    {sub.label}
                  </Link>
                ))}
              </div>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive(item.href)
                  ? "bg-[#f97316] text-white font-medium"
                  : "text-blue-100 hover:bg-white/10"
              )}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default AdminSidebar;
