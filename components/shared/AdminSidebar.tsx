"use client";

import type { ComponentType } from "react";
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
  ShieldAlert,
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
  FileCheck,
  Wallet,
  KeyRound,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  permission?: string;
};

type NavSection = {
  section: string;
  items: NavItem[];
};

type SidebarEntry = NavItem | NavSection;

const navItems: SidebarEntry[] = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
    permission: "dashboard.view",
  },
  {
    section: "ข้อมูลหลัก",
    items: [
      { label: "สินค้า", href: "/admin/products", icon: Package, permission: "products.view" },
      { label: "ลูกค้า", href: "/admin/customers", icon: Users, permission: "customers.view" },
      { label: "หมวดหมู่สินค้า", href: "/admin/master/categories", icon: Tags, permission: "master.view" },
      { label: "แบรนด์อะไหล่", href: "/admin/master/parts-brands", icon: Award, permission: "master.view" },
      { label: "ยี่ห้อ / รุ่นรถ", href: "/admin/master/car-brands", icon: Car, permission: "master.view" },
      { label: "ซัพพลายเออร์", href: "/admin/master/suppliers", icon: Truck, permission: "master.view" },
      { label: "รหัสค่าใช้จ่าย", href: "/admin/master/expense-codes", icon: Wallet, permission: "master.view" },
    ],
  },
  {
    section: "สต็อก",
    items: [
      { label: "ยอดยกมา (BF)", href: "/admin/stock/bf", icon: Archive, permission: "stock.bf.view" },
      { label: "ปรับสต็อก", href: "/admin/stock/adjustments", icon: RefreshCw, permission: "stock.adjustments.view" },
      { label: "Stock Card MAVG", href: "/admin/stock/card", icon: ClipboardList, permission: "stock.card.view" },
    ],
  },
  {
    section: "ระบบงาน",
    items: [
      { label: "ซื้อสินค้าเข้า", href: "/admin/purchases", icon: ShoppingCart, permission: "purchases.view" },
      { label: "คืนสินค้าซัพพลายเออร์", href: "/admin/purchase-returns", icon: RotateCcw, permission: "purchase_returns.view" },
      { label: "บันทึกการขาย", href: "/admin/sales", icon: TrendingUp, permission: "sales.view" },
      { label: "คิวจัดส่ง", href: "/admin/delivery", icon: MapPin, permission: "delivery.view" },
      { label: "Credit Note (CN)", href: "/admin/credit-notes", icon: FileX, permission: "credit_notes.view" },
      { label: "ใบเสร็จรับเงิน", href: "/admin/receipts", icon: FileCheck, permission: "receipts.view" },
      { label: "ประกันสินค้า", href: "/admin/warranties", icon: ShieldCheck, permission: "warranties.view" },
      { label: "ใบเคลมสินค้า", href: "/admin/warranty-claims", icon: ShieldAlert, permission: "warranty_claims.view" },
      { label: "ค่าใช้จ่าย", href: "/admin/expenses", icon: Receipt, permission: "expenses.view" },
    ],
  },
  {
    section: "รายงาน",
    items: [{ label: "รายงาน", href: "/admin/reports", icon: BarChart3, permission: "reports.view" }],
  },
  {
    section: "ระบบ",
    items: [
      { label: "ตั้งค่าร้านค้า", href: "/admin/settings/company", icon: Settings, permission: "settings.company.view" },
      { label: "ผู้ใช้งาน", href: "/admin/users", icon: Users, permission: "admin.users.view" },
      { label: "บทบาทและสิทธิ์", href: "/admin/roles", icon: ShieldCheck, permission: "admin.roles.view" },
      { label: "เปลี่ยนรหัสผ่าน", href: "/admin/profile/change-password", icon: KeyRound },
    ],
  },
];

interface AdminSidebarProps {
  permissions?: string[];
  onClose?: () => void;
}

const AdminSidebar = ({ permissions, onClose }: AdminSidebarProps) => {
  const pathname = usePathname();

  const canAccess = (permission?: string) =>
    !permission || permissions === undefined || permissions.includes(permission);

  const visibleItems = navItems.reduce<SidebarEntry[]>((items, item) => {
    if ("section" in item) {
      const visibleSectionItems = item.items.filter((subItem) => canAccess(subItem.permission));
      if (visibleSectionItems.length > 0) {
        items.push({ ...item, items: visibleSectionItems });
      }
      return items;
    }

    if (canAccess(item.permission)) {
      items.push(item);
    }

    return items;
  }, []);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="flex h-full w-64 flex-col bg-[#1e3a5f] text-white">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div>
          <p className="font-kanit text-lg font-bold leading-tight">ศรีวรรณ อะไหล่แอร์</p>
          <p className="text-xs text-blue-200">ระบบจัดการหลังบ้าน</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 hover:bg-white/10 lg:hidden">
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleItems.map((item, idx) => {
          if ("section" in item) {
            return (
              <div key={`${item.section}-${idx}`} className="pt-3">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-300">
                  {item.section}
                </p>
                {item.items.map((sub) => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive(sub.href)
                        ? "bg-[#f97316] font-medium text-white"
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
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(item.href)
                  ? "bg-[#f97316] font-medium text-white"
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
