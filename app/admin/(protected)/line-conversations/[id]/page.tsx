export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";

import AdminLineConversationActions from "@/components/shared/AdminLineConversationActions";
import AdminLineConversationCustomerLink from "@/components/shared/AdminLineConversationCustomerLink";
import LineAdminTabNav from "@/components/shared/LineAdminTabNav";
import LineConversationScrollAnchor from "@/components/shared/LineConversationScrollAnchor";
import { hasPermissionAccess } from "@/lib/access-control";
import { LineMessageDirection, LineMessageType } from "@/lib/generated/prisma";
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

function directionLabel(
  direction: LineMessageDirection,
  conversationName: string,
  adminName?: string | null,
) {
  if (direction === LineMessageDirection.INBOUND) return conversationName;
  if (direction === LineMessageDirection.OUTBOUND_ADMIN) return adminName ?? "Admin";
  return "AI";
}

function messageBubbleClasses(direction: LineMessageDirection) {
  if (direction === LineMessageDirection.INBOUND) {
    return "rounded-bl-sm bg-white text-gray-900 ring-1 ring-gray-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10";
  }
  if (direction === LineMessageDirection.OUTBOUND_ADMIN) {
    return "rounded-br-sm bg-[#1e3a5f] text-white dark:bg-sky-600";
  }
  return "rounded-br-sm bg-emerald-600 text-white dark:bg-emerald-500";
}

function messageMetaClasses(direction: LineMessageDirection) {
  if (direction === LineMessageDirection.INBOUND) {
    return "text-gray-500 dark:text-slate-400";
  }
  return "text-gray-500 dark:text-slate-400 md:text-right";
}

function conversationDisplayName(conversation: {
  displayName: string | null;
  lineUserId: string;
  customer: { name: string } | null;
}) {
  const lineName = conversation.displayName ?? conversation.lineUserId;
  return conversation.customer ? `${lineName} (${conversation.customer.name})` : lineName;
}

export default async function LineConversationDetailPage({ params }: PageProps) {
  const session = await requirePermission("line_conversations.view");
  const { id } = await params;
  const result = await getLineConversationMessages({ conversationId: id, take: 100 });

  if (!result) notFound();

  const canReply = hasPermissionAccess(session.user.role, session.user.permissions, "line_conversations.reply");
  const canManage = hasPermissionAccess(session.user.role, session.user.permissions, "line_conversations.manage");
  const canViewPaymentSlips = hasPermissionAccess(
    session.user.role,
    session.user.permissions,
    "line_payment_slips.view",
  );
  const { conversation, messages } = result;

  const isLinked = Boolean(conversation.customer?.id);
  const recentOrders = conversation.customer?.id
    ? await getLinkedCustomerRecentOrders({ customerId: conversation.customer.id, take: 5 })
    : [];
  const displayName = conversationDisplayName(conversation);

  return (
    <div className="space-y-4">
      <LineAdminTabNav canViewConversations canViewPaymentSlips={canViewPaymentSlips} />

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
            {displayName}
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
            {isLinked ? "เชื่อมโยงแล้ว" : "ยังไม่เชื่อมโยง"}
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
            บทสนทนานี้ยังไม่ผูกกับลูกค้าในระบบ — ระบบจะผูกอัตโนมัติเฉพาะเมื่อ LINE ID ตรงกัน
            (LIFF กับ OA ต้องอยู่ Provider เดียวกัน) หากไม่ตรง ให้ผูกด้วยมือด้านล่าง
          </p>
        )}

        {canManage ? (
          <AdminLineConversationCustomerLink conversationId={conversation.id} isLinked={isLinked} />
        ) : null}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          กรุณาตอบลูกค้าจากหน้านี้เท่านั้น — ข้อความที่ตอบผ่านแอป/เว็บ{" "}
          <span className="font-semibold">LINE Official Account Manager</span> จะไม่แสดงในประวัติแชทนี้
          เนื่องจากข้อจำกัดของ LINE (ระบบไม่สามารถดึงข้อความที่ส่งจาก OA Manager กลับมาได้)
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-950/40">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
            No messages found
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isInbound = message.direction === LineMessageDirection.INBOUND;

              return (
                <article
                  key={message.id}
                  className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
                >
                  <div className={`flex max-w-[82%] flex-col gap-1 ${isInbound ? "items-start" : "items-end"}`}>
                    <div
                      className={`rounded-2xl px-4 py-3 shadow-sm ${messageBubbleClasses(message.direction)}`}
                    >
                      {message.imageUrl ? (
                        <a href={message.imageUrl} target="_blank" rel="noopener noreferrer" className="block">
                          <Image
                            src={message.imageUrl}
                            alt="รูปภาพในแชท"
                            width={400}
                            height={400}
                            sizes="400px"
                            className="h-auto max-h-72 w-auto max-w-full rounded-lg"
                          />
                        </a>
                      ) : message.messageType === LineMessageType.IMAGE ? (
                        <p className="text-sm italic leading-6 opacity-80">[รูปภาพ]</p>
                      ) : message.messageType === LineMessageType.STICKER ? (
                        <p className="text-sm italic leading-6 opacity-80">[สติกเกอร์]</p>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                          {message.text ?? "(no text)"}
                        </p>
                      )}
                    </div>
                    <div
                      className={`flex max-w-full flex-wrap gap-x-2 gap-y-1 text-xs ${messageMetaClasses(message.direction)}`}
                    >
                      <span className="font-medium">
                        {directionLabel(message.direction, displayName, message.adminUser?.name)}
                      </span>
                      <span>{message.intent ?? message.messageType}</span>
                      <span>{formatDateTimeThai(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                      {message.deliveryMode ? <span>{message.deliveryMode}</span> : null}
                      {message.deliveryStatus ? <span>{message.deliveryStatus}</span> : null}
                      {message.adminUser ? <span>by {message.adminUser.name}</span> : null}
                    </div>
                  </div>
                </article>
              );
            })}
            <LineConversationScrollAnchor messageCount={messages.length} />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 bg-slate-100/95 pb-1 pt-1 backdrop-blur dark:bg-[#08111f]/95">
        <AdminLineConversationActions conversationId={conversation.id} canReply={canReply} canManage={canManage} />
      </div>
    </div>
  );
}
