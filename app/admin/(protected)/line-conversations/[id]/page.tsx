export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, UserRound } from "lucide-react";

import AdminLineConversationActions from "@/components/shared/AdminLineConversationActions";
import { hasPermissionAccess } from "@/lib/access-control";
import { LineMessageDirection } from "@/lib/generated/prisma";
import { getLineConversationMessages } from "@/lib/line-admin-service";
import { getLinkedCustomerRecentOrders } from "@/lib/line-customer-linkage";
import { requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

function formatBaht(amount: { toString(): string }): string {
  const value = Number(amount.toString());
  return Number.isFinite(value)
    ? value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";
}

type PageProps = {
  params: Promise<{ id: string }>;
};

function directionLabel(direction: LineMessageDirection) {
  if (direction === LineMessageDirection.INBOUND) return "Customer";
  if (direction === LineMessageDirection.OUTBOUND_ADMIN) return "Admin";
  return "AI";
}

function messageClasses(direction: LineMessageDirection) {
  if (direction === LineMessageDirection.INBOUND) {
    return "border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/70";
  }
  if (direction === LineMessageDirection.OUTBOUND_ADMIN) {
    return "border-sky-200 bg-sky-50 dark:border-sky-400/30 dark:bg-sky-500/10";
  }
  return "border-emerald-200 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-500/10";
}

export default async function LineConversationDetailPage({ params }: PageProps) {
  const session = await requirePermission("line_conversations.view");
  const { id } = await params;
  const result = await getLineConversationMessages({ conversationId: id, take: 100 });

  if (!result) notFound();

  const canReply = hasPermissionAccess(session.user.role, session.user.permissions, "line_conversations.reply");
  const canManage = hasPermissionAccess(session.user.role, session.user.permissions, "line_conversations.manage");
  const { conversation, messages } = result;

  const isLinked = Boolean(conversation.customer?.id);
  const recentOrders = conversation.customer?.id
    ? await getLinkedCustomerRecentOrders({ customerId: conversation.customer.id, take: 5 })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/admin/line-conversations"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft size={16} />
            Back
          </Link>
          <h1 className="mt-3 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            {conversation.customer?.name ?? conversation.displayName ?? conversation.lineUserId}
          </h1>
          <p className="mt-1 font-mono text-xs text-gray-500 dark:text-slate-400">{conversation.lineUserId}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/70">
          <p className="font-semibold text-gray-900 dark:text-slate-100">{conversation.aiStatus}</p>
          {conversation.pausedReason ? (
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{conversation.pausedReason}</p>
          ) : null}
          {conversation.assignedAdmin ? (
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              Owner: {conversation.assignedAdmin.name}
            </p>
          ) : null}
        </div>
      </div>

      <AdminLineConversationActions conversationId={conversation.id} canReply={canReply} canManage={canManage} />

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
            ลูกค้าที่เชื่อมโยง
          </h2>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              isLinked
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-slate-300"
            }`}
          >
            {isLinked ? "เชื่อมโยงแล้ว (ตรงจาก LINE ID)" : "ยังไม่เชื่อมโยง"}
          </span>
        </div>

        {isLinked ? (
          <div className="mt-2 text-sm text-gray-700 dark:text-slate-200">
            <p className="font-medium">{conversation.customer?.name}</p>
            {conversation.customer?.phone ? (
              <p className="text-gray-500 dark:text-slate-400">{conversation.customer.phone}</p>
            ) : null}

            <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-slate-100">ออเดอร์ล่าสุด</h3>
            {recentOrders.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">ไม่พบออเดอร์</p>
            ) : (
              <ul className="mt-1 divide-y divide-gray-100 dark:divide-white/10">
                {recentOrders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-gray-900 dark:text-slate-100">{order.saleNo}</span>
                      <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">
                        {formatDateTimeThai(order.saleDate, { dateStyle: "medium" })}
                      </span>
                    </div>
                    <div className="text-right text-xs text-gray-600 dark:text-slate-300">
                      <span>{formatBaht(order.netAmount)} ฿</span>
                      {Number(order.amountRemain.toString()) > 0 ? (
                        <span className="ml-2 text-amber-600 dark:text-amber-300">
                          ค้าง {formatBaht(order.amountRemain)} ฿
                        </span>
                      ) : null}
                      <span className="ml-2 text-gray-400 dark:text-slate-500">{order.shippingStatus}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            บทสนทนานี้ยังไม่ผูกกับลูกค้าในระบบ — ระบบจะไม่เดา/ผูกอัตโนมัติจากหลักฐานอ่อน
            สามารถผูกได้โดยให้ลูกค้าเชื่อม LINE ผ่าน LIFF
          </p>
        )}
      </div>

      <div className="space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
            No messages found
          </div>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`rounded-lg border p-4 ${messageClasses(message.direction)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {message.direction === LineMessageDirection.INBOUND ? <UserRound size={16} /> : <Bot size={16} />}
                  <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {directionLabel(message.direction)}
                  </p>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-slate-300">
                    {message.intent ?? message.messageType}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {formatDateTimeThai(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-800 dark:text-slate-200">
                {message.text ?? message.imageUrl ?? "(no text)"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-slate-400">
                {message.deliveryMode ? <span>{message.deliveryMode}</span> : null}
                {message.deliveryStatus ? <span>{message.deliveryStatus}</span> : null}
                {message.adminUser ? <span>by {message.adminUser.name}</span> : null}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
