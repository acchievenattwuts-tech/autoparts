"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, LoaderCircle, RefreshCw } from "lucide-react";

import { useAdminTheme } from "@/components/shared/AdminThemeProvider";
import { formatDateTimeThai } from "@/lib/th-date";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 60_000;

type Severity = "INFO" | "WARNING" | "ERROR";

type NotificationItem = {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const SEVERITY_DOT: Record<Severity, string> = {
  INFO: "bg-sky-500",
  WARNING: "bg-amber-500",
  ERROR: "bg-rose-500",
};

const formatWhen = (value: string) =>
  formatDateTimeThai(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const AdminNotificationBell = ({ userId }: { userId: string }) => {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isDark } = useAdminTheme();

  const fetchSummary = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/admin/notifications?mode=summary", { cache: "no-store" });
      if (!response.ok) {
        setSummaryError(true);
        return;
      }
      const data = (await response.json()) as { unreadCount: number };
      setSummaryError(false);
      setUnreadCount(data.unreadCount);
    } catch {
      setSummaryError(true);
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoadingList(true);
    setListError(false);
    try {
      const response = await fetch("/api/admin/notifications?mode=list&take=8", { cache: "no-store" });
      if (!response.ok) {
        setListError(true);
        return;
      }
      const data = (await response.json()) as { items: NotificationItem[] };
      setItems(data.items);
    } catch {
      setListError(true);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markAllRead" }),
      });
      setUnreadCount(0);
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch {
      /* keep silent; next poll reconciles */
    }
  }, []);

  const markOneRead = useCallback(async (id: string) => {
    try {
      await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markRead", id }),
      });
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
    const intervalId = window.setInterval(() => void fetchSummary(), POLL_INTERVAL_MS);
    const handleFocus = () => void fetchSummary();
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchSummary, userId]);

  useEffect(() => {
    if (!open) return;
    void fetchList();
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
  }, [fetchList, open]);

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
        ) : summaryError ? (
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
                "fixed right-3 top-16 z-[120] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border bg-white shadow-xl sm:right-4",
                "border-slate-200 dark:border-white/10 dark:bg-slate-900",
              )}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/10">
                <p className="font-kanit text-sm font-semibold text-slate-900 dark:text-slate-100">การแจ้งเตือน</p>
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
                >
                  <CheckCheck size={14} />
                  อ่านทั้งหมด
                </button>
              </div>

              <div className="max-h-[22rem] overflow-y-auto py-1">
                {loadingList ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                    <LoaderCircle size={16} className="animate-spin" />
                    กำลังโหลด
                  </div>
                ) : listError ? (
                  <div className="space-y-3 px-4 py-5 text-sm text-slate-600 dark:text-slate-300">
                    <p>โหลดการแจ้งเตือนไม่สำเร็จ</p>
                    <button
                      type="button"
                      onClick={() => void fetchList()}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
                    >
                      <RefreshCw size={14} />
                      โหลดใหม่
                    </button>
                  </div>
                ) : items.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">ยังไม่มีการแจ้งเตือน</div>
                ) : (
                  items.map((item) => {
                    const isUnread = !item.readAt;
                    const content = (
                      <div
                        className={cn(
                          "border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5",
                          isUnread && "bg-orange-50/60 dark:bg-orange-400/5",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                            {item.body ? (
                              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{item.body}</p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{formatWhen(item.createdAt)}</p>
                          </div>
                        </div>
                      </div>
                    );
                    return item.link ? (
                      <Link
                        key={item.id}
                        href={item.link}
                        role="menuitem"
                        onClick={() => {
                          if (isUnread) void markOneRead(item.id);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        key={item.id}
                        type="button"
                        className="block w-full text-left"
                        onClick={() => {
                          if (isUnread) void markOneRead(item.id);
                        }}
                      >
                        {content}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
                <Link
                  href="/admin/notifications"
                  onClick={() => setOpen(false)}
                  className="inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                >
                  ดูการแจ้งเตือนทั้งหมด
                </Link>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default AdminNotificationBell;
