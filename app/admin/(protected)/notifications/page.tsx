export const dynamic = "force-dynamic";

import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";

import { listNotifications } from "@/lib/notifications";
import { getRequiredSession } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

import { markAllNotificationsReadAction } from "./actions";

const SEVERITY_DOT: Record<string, string> = {
  INFO: "bg-sky-500",
  WARNING: "bg-amber-500",
  ERROR: "bg-rose-500",
};

const NotificationsPage = async () => {
  const session = await getRequiredSession();
  const items = await listNotifications(session.user.id, { take: 50 });
  const hasUnread = items.some((item) => !item.readAt);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
            <Bell size={22} />
          </span>
          <div>
            <h1 className="font-kanit text-xl font-bold text-slate-900 dark:text-slate-100">การแจ้งเตือน</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">การแจ้งเตือนภายในระบบของคุณ</p>
          </div>
        </div>
        {hasUnread ? (
          <form action={markAllNotificationsReadAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
            >
              <CheckCheck size={16} />
              ทำเครื่องหมายอ่านทั้งหมด
            </button>
          </form>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
        {items.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">ยังไม่มีการแจ้งเตือน</div>
        ) : (
          items.map((item) => {
            const isUnread = !item.readAt;
            const inner = (
              <div
                className={`flex items-start gap-3 border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 dark:border-white/10 ${
                  isUnread ? "bg-orange-50/60 dark:bg-orange-400/5" : ""
                }`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[item.severity] ?? "bg-slate-400"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                    {isUnread ? (
                      <span className="inline-flex items-center rounded-full bg-orange-600 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-orange-400 dark:text-orange-950">
                        ใหม่
                      </span>
                    ) : null}
                  </div>
                  {item.body ? <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{item.body}</p> : null}
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                    {formatDateTimeThai(item.createdAt, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
            return item.link ? (
              <Link key={item.id} href={item.link} className="block">
                {inner}
              </Link>
            ) : (
              <div key={item.id}>{inner}</div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
