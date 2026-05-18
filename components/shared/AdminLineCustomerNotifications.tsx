"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, Eye, LoaderCircle, Pencil, RefreshCw, UserRoundCheck } from "lucide-react";

import { useAdminTheme } from "@/components/shared/AdminThemeProvider";
import { formatDateTimeThai } from "@/lib/th-date";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 60_000;
const STORAGE_PREFIX = "adminLineCustomerNotifLastSeenAt";

type LineCustomerLinkKind =
  | "LINE_NEW_CUSTOMER"
  | "OLD_CUSTOMER_LINKED"
  | "OLD_CUSTOMER_RELINKED";

type SummaryResponse = {
  unreadCount: number;
  latestLinkedAt: string | null;
};

type NotificationItem = {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  source: string;
  linkKind: LineCustomerLinkKind;
  hasLineLink: boolean;
  isProfileIncomplete: boolean;
  lineLinkedAt: string | null;
};

type ListResponse = {
  items: NotificationItem[];
  latestLinkedAt: string | null;
};

type AdminLineCustomerNotificationsProps = {
  userId: string;
  canUpdateCustomer: boolean;
};

const getStorageKey = (userId: string) => `${STORAGE_PREFIX}:${userId}`;

const readLastSeenAt = (userId: string): string | null => {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(getStorageKey(userId));
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
};

const writeLastSeenAt = (userId: string, value: string | null) => {
  if (typeof window === "undefined" || !value) return;
  window.localStorage.setItem(getStorageKey(userId), value);
};

const formatLinkedAt = (value: string | null) => {
  if (!value) return "-";
  return formatDateTimeThai(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getCustomerKindLabel = (item: NotificationItem) => {
  if (item.linkKind === "OLD_CUSTOMER_RELINKED") return "ลูกค้าเก่าผูก LINE ใหม่";
  if (item.linkKind === "OLD_CUSTOMER_LINKED") return "ลูกค้าเก่าผูก LINE";
  return "ลูกค้าใหม่จาก LINE";
};

const getCustomerKindClass = (item: NotificationItem) => {
  if (item.linkKind === "OLD_CUSTOMER_RELINKED") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200";
  }
  if (item.linkKind === "OLD_CUSTOMER_LINKED") {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200";
  }
  return "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-200";
};

const AdminLineCustomerNotifications = ({
  userId,
  canUpdateCustomer,
}: AdminLineCustomerNotificationsProps) => {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestLinkedAt, setLatestLinkedAt] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [openedLastSeenAt, setOpenedLastSeenAt] = useState<string | null>(null);
  const [pendingReadAt, setPendingReadAt] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [listError, setListError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const { isDark } = useAdminTheme();

  const markReadTo = useCallback(
    (value: string | null) => {
      if (!value) return;
      writeLastSeenAt(userId, value);
      setUnreadCount(0);
      setLatestLinkedAt(value);
    },
    [userId],
  );

  const fetchSummary = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    summaryAbortRef.current?.abort();
    const controller = new AbortController();
    summaryAbortRef.current = controller;

    const lastSeenAt = readLastSeenAt(userId);
    const params = new URLSearchParams({ mode: "summary" });
    if (lastSeenAt) params.set("since", lastSeenAt);

    try {
      const response = await fetch(`/api/admin/notifications/line-customers?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        setSummaryError(true);
        return;
      }
      const data = (await response.json()) as SummaryResponse;
      setSummaryError(false);
      setLatestLinkedAt(data.latestLinkedAt);

      if (!lastSeenAt && data.latestLinkedAt) {
        writeLastSeenAt(userId, data.latestLinkedAt);
        setUnreadCount(0);
        return;
      }

      setUnreadCount(data.unreadCount);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSummaryError(true);
    }
  }, [userId]);

  const fetchList = useCallback(async () => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setLoadingList(true);
    setListError(false);

    try {
      const response = await fetch("/api/admin/notifications/line-customers?mode=list&take=5", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        setListError(true);
        return;
      }
      const data = (await response.json()) as ListResponse;
      setItems(data.items);
      setLatestLinkedAt(data.latestLinkedAt);
      if (open) {
        setPendingReadAt(data.latestLinkedAt);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setListError(true);
    } finally {
      setLoadingList(false);
    }
  }, [open]);

  useEffect(() => {
    void fetchSummary();
    const intervalId = window.setInterval(() => {
      void fetchSummary();
    }, POLL_INTERVAL_MS);

    const handleFocus = () => void fetchSummary();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void fetchSummary();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      summaryAbortRef.current?.abort();
      listAbortRef.current?.abort();
    };
  }, [fetchSummary]);

  useEffect(() => {
    if (!open) return;
    void fetchList();

    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        if (!menuRef.current?.contains(event.target as Node)) {
          setOpen(false);
        }
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

  useEffect(() => {
    if (!open || loadingList || listError || !pendingReadAt) return;

    const frameId = window.requestAnimationFrame(() => {
      markReadTo(pendingReadAt);
      setPendingReadAt(null);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [listError, loadingList, markReadTo, open, pendingReadAt]);

  const handleOpen = () => {
    setOpen((prev) => {
      const nextOpen = !prev;
      if (nextOpen) {
        setOpenedLastSeenAt(readLastSeenAt(userId));
        setPendingReadAt(null);
      }
      return nextOpen;
    });
  };
  const handleMarkAllRead = () => markReadTo(latestLinkedAt);
  const handleNavigate = () => {
    markReadTo(latestLinkedAt);
    setOpen(false);
  };
  const isUnreadItem = (item: NotificationItem) => {
    if (!item.lineLinkedAt || !openedLastSeenAt) return false;
    return new Date(item.lineLinkedAt).getTime() > new Date(openedLastSeenAt).getTime();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="แจ้งเตือนลูกค้าที่ผูก LINE"
        title="แจ้งเตือนลูกค้าที่ผูก LINE"
        className={cn(
          "relative inline-flex h-10 w-10 items-center justify-center rounded-lg border text-sm shadow-sm transition-colors",
          "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
          "dark:border-white/10 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white",
          open && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
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

      {open && createPortal(
        <div className={isDark ? "dark" : ""}>
        <div
          ref={menuRef}
          role="menu"
          className={cn(
            "fixed right-3 top-16 z-[120] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border bg-white shadow-xl sm:right-4",
            "border-slate-200 dark:border-white/10 dark:bg-slate-900",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/10">
            <div className="min-w-0">
              <p className="font-kanit text-sm font-semibold text-slate-900 dark:text-slate-100">
                ลูกค้าผูก LINE
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                รายการล่าสุดจาก LIFF และลูกค้าเดิมที่ยืนยันเบอร์
              </p>
            </div>
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={!latestLinkedAt || unreadCount === 0}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
            >
              <CheckCheck size={14} />
              อ่านแล้ว
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto py-1">
            {loadingList ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                <LoaderCircle size={16} className="animate-spin" />
                กำลังโหลดรายการล่าสุด
              </div>
            ) : listError ? (
              <div className="space-y-3 px-4 py-5 text-sm text-slate-600 dark:text-slate-300">
                <p>โหลดแจ้งเตือนไม่สำเร็จ</p>
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
              <div className="flex items-start gap-3 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                <UserRoundCheck size={18} className="mt-0.5 shrink-0 text-slate-400" />
                ยังไม่มีลูกค้าที่ผูก LINE
              </div>
            ) : (
              items.map((item) => {
                const isUnread = isUnreadItem(item);
                return (
                <div
                  key={item.id}
                  className={cn(
                    "border-b border-slate-100 last:border-b-0 dark:border-white/10",
                    isUnread && "bg-emerald-50/80 dark:bg-emerald-400/10",
                  )}
                >
                  <div className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
                    <Link
                      href={`/admin/customers/${item.id}`}
                      onClick={handleNavigate}
                      role="menuitem"
                      className="min-w-0 flex-1"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {item.name}
                        </p>
                        {isUnread ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-emerald-400 dark:text-emerald-950">
                            ใหม่
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            getCustomerKindClass(item),
                          )}
                        >
                          {getCustomerKindLabel(item)}
                        </span>
                        {item.isProfileIncomplete ? (
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                            ข้อมูลยังไม่ครบ
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {[item.code ?? null, item.phone ?? null].filter(Boolean).join(" · ") || "ไม่มีรหัส/เบอร์โทร"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        ผูกเมื่อ {formatLinkedAt(item.lineLinkedAt)}
                      </p>
                    </Link>
                    <div className="flex shrink-0 items-center gap-1">
                      {canUpdateCustomer ? (
                        <Link
                          href={`/admin/customers/${item.id}/edit`}
                          onClick={handleNavigate}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-white/10 dark:text-slate-300 dark:hover:border-emerald-400/30 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-200"
                        >
                          <Pencil size={13} />
                          แก้ไข
                        </Link>
                      ) : null}
                      <Eye size={16} className="text-slate-400 dark:text-slate-500" />
                    </div>
                  </div>
                </div>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
            <Link
              href="/admin/customers?source=LINE_LIFF"
              onClick={handleNavigate}
              className="inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
            >
              ดูลูกค้าจาก LINE ทั้งหมด
            </Link>
          </div>
        </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default AdminLineCustomerNotifications;
