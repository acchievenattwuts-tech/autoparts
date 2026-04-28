"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ADMIN_NAVIGATION, filterAdminNavigationByPermission } from "@/lib/admin-navigation";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  permissions?: string[];
  onClose?: () => void;
}

const AdminSidebar = ({ permissions, onClose }: AdminSidebarProps) => {
  const pathname = usePathname();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const visibleItems = filterAdminNavigationByPermission(ADMIN_NAVIGATION, permissions);
  const visibleHrefs = visibleItems.flatMap((item) => item.items.map((subItem) => subItem.href));

  const activeHref =
    visibleHrefs
      .filter((href) =>
        href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`)
      )
      .sort((left, right) => right.length - left.length)[0] ?? "";

  const isActive = (href: string) => href === activeHref;

  const isSectionExpanded = (section: string, hasActiveItem: boolean) => expandedSections[section] ?? hasActiveItem;

  const toggleSection = (section: string, hasActiveItem: boolean) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !(current[section] ?? hasActiveItem),
    }));
  };

  return (
    <div className="flex h-full w-64 flex-col bg-[#1e3a5f] text-white dark:border-r dark:border-white/10 dark:bg-[#0f172a]">
      <div className="flex items-center justify-between border-b border-white/10 p-4 dark:border-white/10">
        <div>
          <p className="font-kanit text-lg font-bold leading-tight">ศรีวรรณ อะไหล่แอร์</p>
          <p className="text-xs text-blue-200 dark:text-slate-400">ระบบจัดการหลังบ้าน</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 transition-colors hover:bg-white/10 lg:hidden">
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleItems.map((item, idx) => {
          const hasActiveItem = item.items.some((sub) => isActive(sub.href));
          const showSectionItems = isSectionExpanded(item.section, hasActiveItem);

          return (
            <div key={`${item.section}-${idx}`} className="pt-3">
              <button
                type="button"
                onClick={() => toggleSection(item.section, hasActiveItem)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wider transition-colors",
                  hasActiveItem
                    ? "bg-white/10 text-white dark:bg-white/8 dark:text-slate-100"
                    : "text-blue-200 hover:bg-white/8 hover:text-white dark:text-slate-400 dark:hover:bg-white/6 dark:hover:text-slate-300"
                )}
              >
                <span>{item.section}</span>
                {showSectionItems ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {showSectionItems &&
                item.items.map((sub) => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors",
                      isActive(sub.href)
                        ? "bg-[#f97316] font-medium text-white shadow-sm shadow-orange-950/10 dark:bg-orange-500 dark:text-slate-950"
                        : "text-blue-50 hover:bg-white/10 dark:text-slate-300 dark:hover:bg-white/8"
                    )}
                  >
                    <sub.icon size={18} />
                    {sub.label}
                  </Link>
                ))}
            </div>
          );
        })}
      </nav>
    </div>
  );
};

export default AdminSidebar;
