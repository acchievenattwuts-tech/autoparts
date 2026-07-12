"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";

import type { AdminNotificationSection } from "@/components/shared/admin-notification-center-types";
import {
  ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS,
  shouldPollNotificationSummary,
} from "@/components/shared/admin-notification-center-utils";
import { formatDateTimeThai } from "@/lib/th-date";
import { cn } from "@/lib/utils";

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

type UseAdminSystemNotificationSourceParams = {
  userId: string;
  isOpen: boolean;
  closePanel: () => void;
};

const SEVERITY_DOT: Record<Severity, string> = {
  INFO: "bg-sky-500",
  WARNING: "bg-amber-500",
  ERROR: "bg-rose-500",
};

/** Daily out-of-stock digest carries the full product list in its body (for Telegram). */
const STOCK_OUT_DAILY_TYPE = "STOCK_OUT_DAILY";

/** Pulls "รวม N รายการ" out of the digest body so the bell can show a one-line summary. */
const parseOutOfStockCount = (body: string | null): number | null => {
  if (!body) return null;
  const match = body.match(/รวม\s+([\d,]+)\s+รายการ/);
  if (!match) return null;
  const count = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(count) ? count : null;
};

const formatWhen = (value: string) =>
  formatDateTimeThai(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function useAdminSystemNotificationSource({
  userId,
  isOpen,
  closePanel,
}: UseAdminSystemNotificationSourceParams): AdminNotificationSection {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [pendingMarkAllRead, setPendingMarkAllRead] = useState(false);
  const lastFetchedAtRef = useRef<number>(0);

  const fetchSummary = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    lastFetchedAtRef.current = Date.now();
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
      setPendingMarkAllRead(data.items.some((item) => !item.readAt));
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
      /* next poll reconciles */
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
      setItems((current) => current.map((item) => (item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item)));
    } catch {
      /* ignore */
    }
  }, []);

  const openNotification = useCallback(
    async (item: NotificationItem, isUnread: boolean) => {
      if (isUnread) {
        await markOneRead(item.id);
      }
      closePanel();
      if (item.link) {
        router.push(item.link);
      }
    },
    [closePanel, markOneRead, router],
  );

  useEffect(() => {
    void fetchSummary();
    const intervalId = window.setInterval(() => {
      if (
        shouldPollNotificationSummary({
          now: Date.now(),
          lastFetchedAt: lastFetchedAtRef.current,
          isDocumentHidden: document.visibilityState === "hidden",
        })
      ) {
        void fetchSummary();
      }
    }, ADMIN_NOTIFICATION_SUMMARY_POLL_INTERVAL_MS);

    const handleFocus = () => {
      if (
        shouldPollNotificationSummary({
          now: Date.now(),
          lastFetchedAt: lastFetchedAtRef.current,
          isDocumentHidden: false,
        })
      ) {
        void fetchSummary();
      }
    };

    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        shouldPollNotificationSummary({
          now: Date.now(),
          lastFetchedAt: lastFetchedAtRef.current,
          isDocumentHidden: false,
        })
      ) {
        void fetchSummary();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchSummary, userId]);

  useEffect(() => {
    if (!isOpen) return;
    setPendingMarkAllRead(false);
    void fetchList();
  }, [fetchList, isOpen]);

  useEffect(() => {
    if (!isOpen || loadingList || listError || !pendingMarkAllRead) return;

    const frameId = window.requestAnimationFrame(() => {
      void markAllRead();
      setPendingMarkAllRead(false);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, listError, loadingList, markAllRead, pendingMarkAllRead]);

  const content = loadingList ? (
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
    <>
      {items.map((item) => {
        const isUnread = !item.readAt;
        const stockOutCount = item.type === STOCK_OUT_DAILY_TYPE ? parseOutOfStockCount(item.body) : null;
        const isStockOutDigest = stockOutCount !== null;
        const contentNode = (
          <div
            className={cn(
              "border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5",
              isUnread && "bg-orange-50/60 dark:bg-orange-400/5",
            )}
          >
            <div className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                {isStockOutDigest ? (
                  <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-300">
                    ต้องสั่งเพิ่ม{" "}
                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                      {stockOutCount.toLocaleString("th-TH")} รายการ
                    </span>
                  </p>
                ) : item.body ? (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{item.body}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{formatWhen(item.createdAt)}</p>
              </div>
              {isStockOutDigest ? (
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />
              ) : null}
            </div>
          </div>
        );

        return item.link ? (
          <Link
            key={item.id}
            href={item.link}
            onClick={(event) => {
              event.preventDefault();
              void openNotification(item, isUnread);
            }}
          >
            {contentNode}
          </Link>
        ) : (
          <button
            key={item.id}
            type="button"
            className="block w-full text-left"
            onClick={() => void openNotification(item, isUnread)}
          >
            {contentNode}
          </button>
        );
      })}
      <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <Link
          href="/admin/notifications"
          onClick={closePanel}
          className="inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
        >
          ดูการแจ้งเตือนทั้งหมด
        </Link>
      </div>
    </>
  );

  return {
    key: "system",
    title: "ระบบ",
    description: "การแจ้งเตือนจาก workflow ภายในระบบ",
    unreadCount,
    summaryError,
    markAllLabel: "อ่านทั้งหมด",
    onMarkAllRead: markAllRead,
    isMarkAllDisabled: unreadCount === 0,
    content,
  };
}
