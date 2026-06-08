export const dynamic = "force-dynamic";

import Link from "next/link";
import { Info, MessageCircle } from "lucide-react";

import LineAdminTabNav from "@/components/shared/LineAdminTabNav";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { hasPermissionAccess } from "@/lib/access-control";
import { LineConversationAiStatus } from "@/lib/generated/prisma";
import { listLineConversations } from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

const statusOptions = Object.values(LineConversationAiStatus);

function statusBadge(status: LineConversationAiStatus) {
  const classes: Record<LineConversationAiStatus, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
    PAUSED_BY_ADMIN: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
    WAITING_ADMIN: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
    CLOSED: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-slate-300",
  };

  return `rounded-full px-2.5 py-1 text-xs font-semibold ${classes[status]}`;
}

export default async function LineConversationsPage({ searchParams }: PageProps) {
  const session = await requirePermission("line_conversations.view");
  const params = await searchParams;
  const status = statusOptions.includes(params.status as LineConversationAiStatus)
    ? (params.status as LineConversationAiStatus)
    : null;
  const conversations = await listLineConversations({ status, take: 80 });
  const canReply = hasPermissionAccess(session.user.role, session.user.permissions, "line_conversations.reply");
  const canManage = hasPermissionAccess(session.user.role, session.user.permissions, "line_conversations.manage");
  const canViewPaymentSlips = hasPermissionAccess(
    session.user.role,
    session.user.permissions,
    "line_payment_slips.view",
  );

  return (
    <div className="space-y-4">
      <LineAdminTabNav canViewConversations canViewPaymentSlips={canViewPaymentSlips} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-sky-500/10 dark:text-sky-200">
            <MessageCircle size={21} />
          </div>
          <div>
            <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
              LINE OA Conversations
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {conversations.length.toLocaleString("th-TH")} conversations
            </p>
          </div>
        </div>

        <AdminSearchForm
          action="/admin/line-conversations"
          className="flex flex-wrap items-end gap-2 space-y-0"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
            Status
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">All</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <AdminSearchSubmitButton className="h-10 rounded-md">Filter</AdminSearchSubmitButton>
          <Link
            href="/admin/line-conversations"
            className="inline-flex h-10 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
          >
            Clear
          </Link>
        </AdminSearchForm>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          ตอบลูกค้าจากในระบบนี้เท่านั้น — ข้อความที่ตอบผ่าน{" "}
          <span className="font-semibold">LINE Official Account Manager</span> จะไม่แสดงที่นี่ (ข้อจำกัดของ LINE)
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/70">
        {conversations.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400">
            No conversations found
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {conversations.map((conversation) => (
              <Link
                key={conversation.id}
                href={`/admin/line-conversations/${conversation.id}`}
                className="block px-4 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-gray-900 dark:text-slate-100">
                        {conversation.customer?.name ?? conversation.displayName ?? conversation.lineUserId}
                      </p>
                      <span className={statusBadge(conversation.aiStatus)}>{conversation.aiStatus}</span>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-slate-400">
                      {conversation.lineUserId}
                    </p>
                    <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
                      {conversation.customer?.phone ?? "ยังไม่พบลูกค้าในระบบที่เชื่อมโยง"}
                    </p>
                  </div>
                  <div className="shrink-0 text-left text-xs text-gray-500 dark:text-slate-400 md:text-right">
                    <p>{conversation._count.messages.toLocaleString("th-TH")} messages</p>
                    <p className="mt-1">
                      {conversation.lastCustomerMessageAt
                        ? formatDateTimeThai(conversation.lastCustomerMessageAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "No customer message"}
                    </p>
                    {conversation.assignedAdmin ? <p className="mt-1">Owner: {conversation.assignedAdmin.name}</p> : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 dark:text-slate-400">
        Access: view{canReply ? " / reply" : ""}{canManage ? " / manage" : ""}
      </div>
    </div>
  );
}
