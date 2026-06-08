"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";

import type { AdminNotificationSection } from "@/components/shared/admin-notification-center-types";
import { aggregateUnreadCounts } from "@/components/shared/admin-notification-center-utils";
import { useAdminTheme } from "@/components/shared/AdminThemeProvider";
import { useAdminLineCustomerNotificationSource } from "@/components/shared/use-admin-line-customer-notification-source";
import { useAdminSystemNotificationSource } from "@/components/shared/use-admin-system-notification-source";
import { cn } from "@/lib/utils";

type AdminNotificationCenterProps = {
  userId: string;
  canViewCustomerNotifications: boolean;
  canUpdateCustomer: boolean;
};

const AdminNotificationCenter = ({
  userId,
  canViewCustomerNotifications,
  canUpdateCustomer,
}: AdminNotificationCenterProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isDark } = useAdminTheme();

  const closePanel = () => setOpen(false);
  const systemSection = useAdminSystemNotificationSource({
    userId,
    isOpen: open,
    closePanel,
  });
  const lineSection = useAdminLineCustomerNotificationSource({
    enabled: canViewCustomerNotifications,
    userId,
    canUpdateCustomer,
    isOpen: open,
    closePanel,
  });

  const sections = useMemo(
    () => [systemSection, lineSection].filter((section): section is AdminNotificationSection => section !== null),
    [lineSection, systemSection],
  );

  const unreadCount = aggregateUnreadCounts(sections.map((section) => section.unreadCount));
  const hasSummaryError = sections.some((section) => section.summaryError);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="การแจ้งเตือน"
        title="การแจ้งเตือน"
        className={cn(
          "relative inline-flex h-10 w-10 items-center justify-center rounded-lg border text-sm shadow-sm transition-colors",
          "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
          "dark:border-white/10 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white",
          open && "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
        )}
      >
        <Bell size={17} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full border border-white bg-rose-600 px-1 text-center text-[10px] font-semibold leading-5 text-white shadow-sm dark:border-slate-950">
            {unreadCount > 99 ? "99+" : unreadCount.toLocaleString("th-TH")}
          </span>
        ) : hasSummaryError ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" />
        ) : null}
      </button>

      {open &&
        createPortal(
          <div className={isDark ? "dark" : ""}>
            <div
              ref={menuRef}
              role="menu"
              className={cn(
                "fixed right-3 top-16 z-[120] w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border bg-white shadow-xl sm:right-4",
                "border-slate-200 dark:border-white/10 dark:bg-slate-900",
              )}
            >
              <div className="border-b border-slate-100 px-4 py-3 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <p className="font-kanit text-sm font-semibold text-slate-900 dark:text-slate-100">การแจ้งเตือน</p>
                  {unreadCount > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {unreadCount.toLocaleString("th-TH")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  ศูนย์กลางแจ้งเตือนรวมสำหรับระบบและ LINE OA
                </p>
              </div>

              <div className="max-h-[30rem] overflow-y-auto">
                {sections.map((section, index) => (
                  <section
                    key={section.key}
                    className={cn(index > 0 && "border-t border-slate-100 dark:border-white/10")}
                    aria-label={section.title}
                  >
                    <div className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{section.title}</p>
                          {section.unreadCount > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-slate-100 dark:text-slate-950">
                              {section.unreadCount.toLocaleString("th-TH")}
                            </span>
                          ) : null}
                          {section.summaryError ? (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
                              sync issue
                            </span>
                          ) : null}
                        </div>
                        {section.description ? (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{section.description}</p>
                        ) : null}
                      </div>
                      {section.onMarkAllRead ? (
                        <button
                          type="button"
                          onClick={section.onMarkAllRead}
                          disabled={section.isMarkAllDisabled}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                          <CheckCheck size={14} />
                          {section.markAllLabel ?? "อ่านแล้ว"}
                        </button>
                      ) : (
                        <span className="inline-flex h-8 shrink-0 items-center text-slate-300 dark:text-slate-600">
                          <ChevronRight size={14} />
                        </span>
                      )}
                    </div>
                    <div>{section.content}</div>
                  </section>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default AdminNotificationCenter;
