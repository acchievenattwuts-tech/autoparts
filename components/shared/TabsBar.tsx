"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useTabStore } from "@/hooks/useTabStore";
import { cn } from "@/lib/utils";

const ROUTE_LABELS: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/products": "สินค้า",
  "/admin/customers": "ลูกค้า",
  "/admin/master/categories": "หมวดหมู่สินค้า",
  "/admin/master/parts-brands": "แบรนด์อะไหล่",
  "/admin/master/car-brands": "ยี่ห้อ / รุ่นรถ",
  "/admin/master/suppliers": "ซัพพลายเออร์",
  "/admin/master/expense-codes": "รหัสค่าใช้จ่าย",
  "/admin/stock/bf": "ยอดยกมา (BF)",
  "/admin/stock/adjustments": "ปรับสต็อก",
  "/admin/stock/card": "Stock Card MAVG",
  "/admin/lots": "Stock Card Lot",
  "/admin/purchases": "ซื้อสินค้าเข้า",
  "/admin/purchase-returns": "คืนสินค้าซัพพลายเออร์",
  "/admin/sales": "บันทึกการขาย",
  "/admin/credit-notes": "Credit Note (CN)",
  "/admin/receipts": "ใบเสร็จรับเงิน",
  "/admin/delivery": "คิวจัดส่ง",
  "/admin/warranties": "ประกันสินค้า",
  "/admin/warranty-claims": "ใบเคลมสินค้า",
  "/admin/expenses": "ค่าใช้จ่าย",
  "/admin/cash-bank": "บัญชีเงินสด / ธนาคาร",
  "/admin/cash-bank/ledger": "Cash / Bank Ledger",
  "/admin/cash-bank/transfers": "โอนเงินระหว่างบัญชี",
  "/admin/cash-bank/adjustments": "ปรับยอดเงิน",
  "/admin/reports": "รายงาน",
  "/admin/reports/cash-bank-ledger": "Cash / Bank Ledger",
  "/admin/settings/company": "ตั้งค่าร้านค้า",
  "/admin/users": "ผู้ใช้งาน",
  "/admin/roles": "บทบาทและสิทธิ์",
  "/admin/profile/change-password": "เปลี่ยนรหัสผ่าน",
};

const SORTED_ROUTES = Object.keys(ROUTE_LABELS).sort((a, b) => b.length - a.length);

function normalizePath(path: string): string {
  return SORTED_ROUTES.find((route) => path === route || path.startsWith(`${route}/`)) ?? path;
}

const TabsBar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { tabs, addTab, removeTab } = useTabStore();

  useEffect(() => {
    const basePath = normalizePath(pathname);
    const label = ROUTE_LABELS[basePath];
    if (label) addTab({ path: basePath, label });
  }, [pathname, addTab]);

  useEffect(() => {
    const basePath = normalizePath(pathname);
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-path="${basePath}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [tabs, pathname]);

  if (tabs.length === 0) return null;

  const activePath = normalizePath(pathname);

  const handleClose = (event: React.MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    const index = tabs.findIndex((tab) => tab.path === path);
    removeTab(path);
    if (path === activePath && tabs.length > 1) {
      const nextTab = tabs[index + 1] ?? tabs[index - 1];
      if (nextTab) router.push(nextTab.path);
    }
  };

  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-gray-100">
      <div
        ref={scrollRef}
        className="flex gap-0.5 overflow-x-auto px-2 pt-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar]:hidden"
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
                "group flex flex-shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 px-3.5 py-2 text-sm transition-all",
                isActive
                  ? "border-gray-200 bg-white font-medium text-[#1e3a5f] shadow-[0_-1px_3px_rgba(0,0,0,0.04)]"
                  : "border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200/70 hover:text-gray-700"
              )}
            >
              <span>{tab.label}</span>
              <button
                onClick={(event) => handleClose(event, tab.path)}
                className={cn(
                  "ml-0.5 rounded-full p-0.5 transition-all",
                  isActive
                    ? "text-gray-400 hover:bg-blue-100 hover:text-[#1e3a5f]"
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
