"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useTabStore } from "@/hooks/useTabStore";
import { cn } from "@/lib/utils";

// Route label map — matches AdminSidebar navItems exactly
const ROUTE_LABELS: Record<string, string> = {
  "/admin":                       "Dashboard",
  "/admin/products":              "สินค้า",
  "/admin/customers":             "ลูกค้า",
  "/admin/master/categories":     "หมวดหมู่สินค้า",
  "/admin/master/parts-brands":   "แบรนด์อะไหล่",
  "/admin/master/car-brands":     "ยี่ห้อ / รุ่นรถ",
  "/admin/master/suppliers":      "ซัพพลายเออร์",
  "/admin/stock/bf":              "ยอดยกมา (BF)",
  "/admin/stock/adjustments":     "ปรับสต็อก",
  "/admin/stock/card":            "Stock Card MAVG",
  "/admin/purchases":             "ซื้อสินค้าเข้า",
  "/admin/purchase-returns":      "คืนสินค้าซัพพลายเออร์",
  "/admin/sales":                 "บันทึกการขาย",
  "/admin/credit-notes":          "Credit Note (CN)",
  "/admin/receipts":              "ใบเสร็จรับเงิน",
  "/admin/warranties":            "ประกันสินค้า",
  "/admin/expenses":              "ค่าใช้จ่าย",
  "/admin/reports":               "รายงาน",
  "/admin/settings/company":      "ตั้งค่าร้านค้า",
};

// Longest-match normalization: /admin/sales/new → /admin/sales
const SORTED_ROUTES = Object.keys(ROUTE_LABELS).sort((a, b) => b.length - a.length);

function normalizePath(path: string): string {
  return (
    SORTED_ROUTES.find((r) => path === r || path.startsWith(r + "/")) ?? path
  );
}

const TabsBar = () => {
  const pathname  = usePathname();
  const router    = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { tabs, addTab, removeTab } = useTabStore();

  // Add tab when navigating
  useEffect(() => {
    const basePath = normalizePath(pathname);
    const label    = ROUTE_LABELS[basePath];
    if (label) addTab({ path: basePath, label });
  }, [pathname, addTab]);

  // Scroll active tab into view when tabs change
  useEffect(() => {
    const basePath = normalizePath(pathname);
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-path="${basePath}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [tabs, pathname]);

  if (tabs.length === 0) return null;

  const activePath = normalizePath(pathname);

  const handleClose = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    const idx = tabs.findIndex((t) => t.path === path);
    removeTab(path);
    if (path === activePath && tabs.length > 1) {
      const next = tabs[idx + 1] ?? tabs[idx - 1];
      if (next) router.push(next.path);
    }
  };

  return (
    <div className="bg-gray-100 border-b border-gray-200 flex-shrink-0">
      <div
        ref={scrollRef}
        className="flex overflow-x-auto pt-1.5 px-2 gap-0.5 [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar-button]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.path === activePath;
          return (
            <div
              key={tab.path}
              data-path={tab.path}
              onClick={() => router.push(tab.path)}
              className={cn(
                "group flex items-center gap-1.5 px-3.5 py-2 text-sm whitespace-nowrap cursor-pointer transition-all flex-shrink-0 select-none rounded-t-lg border border-b-0",
                isActive
                  ? "bg-white text-[#1e3a5f] font-medium border-gray-200 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]"
                  : "bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200/70 hover:text-gray-700"
              )}
            >
              <span>{tab.label}</span>
              <button
                onClick={(e) => handleClose(e, tab.path)}
                className={cn(
                  "rounded-full p-0.5 transition-all ml-0.5",
                  isActive
                    ? "text-gray-400 hover:text-[#1e3a5f] hover:bg-blue-100"
                    : "text-transparent group-hover:text-gray-400 hover:!text-gray-600 hover:bg-gray-300"
                )}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TabsBar;
