"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Star,
  X,
} from "lucide-react";
import {
  ADMIN_NAVIGATION,
  filterAdminNavigationByPermission,
  type AdminNavItem,
} from "@/lib/admin-navigation";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
import type { FavoriteMenusController } from "@/components/shared/use-admin-favorite-menus";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  permissions?: string[];
  favoriteMenus: FavoriteMenusController;
  onClose?: () => void;
}

const FAVORITES_SECTION_LABEL = "รายการโปรด";

const AdminSidebar = ({ permissions, favoriteMenus, onClose }: AdminSidebarProps) => {
  const pathname = usePathname();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const visibleItems = filterAdminNavigationByPermission(ADMIN_NAVIGATION, permissions);
  const visibleHrefs = visibleItems.flatMap((item) => item.items.map((subItem) => subItem.href));

  // เมนูโปรดต้องผ่านการกรองสิทธิ์ซ้ำอีกชั้น — ถ้าผู้ใช้ถูกถอนสิทธิ์ ให้ซ่อนโดยไม่ลบข้อมูล
  const itemByHref = new Map<string, AdminNavItem>(
    visibleItems.flatMap((section) => section.items.map((item) => [item.href, item] as const)),
  );
  const favoriteItems = favoriteMenus.favorites
    .map((href) => itemByHref.get(href))
    .filter((item): item is AdminNavItem => item !== undefined);

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

  const linkClassName = (href: string) =>
    cn(
      "mt-1 flex min-h-10 flex-1 items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 text-[15px] transition-colors",
      isActive(href)
        ? "bg-white font-semibold text-[#17365d] shadow-[0_8px_20px_rgba(15,23,42,0.15)] dark:bg-sky-500 dark:text-white dark:shadow-[0_4px_14px_rgba(14,165,233,0.35)]"
        : "text-sky-50/95 hover:bg-white/10 hover:text-white dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-slate-50",
    );

  const iconButtonClassName = (disabled: boolean) =>
    cn(
      "mt-1 inline-flex h-9 w-7 shrink-0 items-center justify-center rounded-lg text-sky-100/80 transition-colors hover:bg-white/10 hover:text-white dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-50",
      disabled && "cursor-not-allowed opacity-30 hover:bg-transparent hover:text-sky-100/80",
    );

  const renderStarButton = (item: AdminNavItem) => {
    const active = favoriteMenus.isFavorite(item.href);
    return (
      <button
        type="button"
        onClick={() => favoriteMenus.toggle(item.href)}
        aria-label={active ? `เอา ${item.label} ออกจากรายการโปรด` : `เพิ่ม ${item.label} ในรายการโปรด`}
        aria-pressed={active}
        title={active ? "เอาออกจากรายการโปรด" : "เพิ่มในรายการโปรด"}
        className={cn(
          "mt-1 inline-flex h-9 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          active
            ? "text-amber-300 hover:bg-white/10 hover:text-amber-200 dark:text-amber-400 dark:hover:bg-white/10"
            : "text-sky-100/50 hover:bg-white/10 hover:text-white dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100",
        )}
      >
        <Star size={16} className={active ? "fill-current" : undefined} />
      </button>
    );
  };

  const favoritesExpanded = isSectionExpanded(FAVORITES_SECTION_LABEL, true);

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
        {favoriteItems.length > 0 && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => toggleSection(FAVORITES_SECTION_LABEL, true)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-amber-200 transition-colors hover:bg-white/10 hover:text-amber-100 dark:text-amber-300 dark:hover:bg-white/10"
            >
              <span className="flex items-center gap-2">
                <Star size={14} className="fill-current" />
                {FAVORITES_SECTION_LABEL}
              </span>
              {favoritesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {favoritesExpanded &&
              favoriteItems.map((item, index) => (
                <div key={`favorite-${item.href}`} className="flex items-start gap-1">
                  <Link href={item.href} onClick={onClose} className={linkClassName(item.href)}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <item.icon size={18} className="shrink-0 opacity-90" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <LinkPendingIndicator />
                  </Link>
                  <button
                    type="button"
                    onClick={() => favoriteMenus.move(item.href, "up")}
                    disabled={index === 0 || favoriteMenus.isPending}
                    aria-label={`เลื่อน ${item.label} ขึ้น`}
                    className={iconButtonClassName(index === 0 || favoriteMenus.isPending)}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => favoriteMenus.move(item.href, "down")}
                    disabled={index === favoriteItems.length - 1 || favoriteMenus.isPending}
                    aria-label={`เลื่อน ${item.label} ลง`}
                    className={iconButtonClassName(index === favoriteItems.length - 1 || favoriteMenus.isPending)}
                  >
                    <ChevronDown size={16} />
                  </button>
                  {renderStarButton(item)}
                </div>
              ))}
          </div>
        )}

        {favoriteMenus.error && (
          <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-100 dark:bg-rose-500/10 dark:text-rose-200">
            {favoriteMenus.error}
          </p>
        )}

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
                item.items.map((sub, subIdx) => (
                  <div key={sub.href} className="flex items-start gap-1">
                    <Link href={sub.href} onClick={onClose} className={linkClassName(sub.href)}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="w-4 shrink-0 text-right text-xs tabular-nums opacity-60">
                          {subIdx + 1}
                        </span>
                        <sub.icon size={18} className="shrink-0 opacity-90" />
                        <span className="truncate">{sub.label}</span>
                      </span>
                      <LinkPendingIndicator />
                    </Link>
                    {renderStarButton(sub)}
                  </div>
                ))}
            </div>
          );
        })}
      </nav>
    </div>
  );
};

export default AdminSidebar;
