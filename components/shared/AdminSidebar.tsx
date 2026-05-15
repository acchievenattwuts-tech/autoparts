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
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
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
    <div className="flex h-full w-72 flex-col border-r border-sky-950/15 bg-gradient-to-b from-[#17365d] via-[#163055] to-[#102948] text-white shadow-xl dark:border-white/10 dark:from-[#0b1424] dark:via-[#0b1424] dark:to-[#09101c]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 dark:border-white/10">
        <div className="min-w-0">
          <p className="font-kanit text-lg font-bold leading-tight text-white dark:text-slate-50">ศรีวรรณ อะไหล่แอร์</p>
          <p className="mt-0.5 text-xs text-sky-100/75 dark:text-slate-300">ระบบจัดการหลังบ้าน</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close admin navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white shadow-sm transition-colors hover:bg-white/20 hover:text-white lg:hidden dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {visibleItems.map((item, idx) => {
          const hasActiveItem = item.items.some((sub) => isActive(sub.href));
          const showSectionItems = isSectionExpanded(item.section, hasActiveItem);

          return (
            <div key={`${item.section}-${idx}`} className="pt-2">
              <button
                type="button"
                onClick={() => toggleSection(item.section, hasActiveItem)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wide transition-colors",
                  hasActiveItem
                    ? "bg-white/18 text-white shadow-sm shadow-black/10 dark:bg-white/15 dark:text-slate-50"
                    : "text-sky-100/80 hover:bg-white/10 hover:text-white dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100"
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
                      "mt-1 flex min-h-10 items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
                      isActive(sub.href)
                        ? "bg-white font-semibold text-[#17365d] shadow-[0_8px_20px_rgba(15,23,42,0.15)] dark:bg-sky-500 dark:text-white dark:shadow-[0_4px_14px_rgba(14,165,233,0.35)]"
                        : "text-sky-50/95 hover:bg-white/10 hover:text-white dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-slate-50"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <sub.icon size={18} className="shrink-0 opacity-90" />
                      <span className="truncate">{sub.label}</span>
                    </span>
                    <LinkPendingIndicator />
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
