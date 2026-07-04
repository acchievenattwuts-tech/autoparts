export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import MessengerConversationPanel from "@/components/shared/MessengerConversationPanel";
import { hasPermissionAccess } from "@/lib/access-control";
import { LineMessageDirection } from "@/lib/generated/prisma";
import { getMessengerConversationMessages } from "@/lib/messenger-admin-service";
import { requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

type PageProps = {
  params: Promise<{ id: string }>;
};

function bubbleAlignment(direction: LineMessageDirection): string {
  return direction === LineMessageDirection.INBOUND ? "items-start" : "items-end";
}

function bubbleStyle(direction: LineMessageDirection): string {
  if (direction === LineMessageDirection.INBOUND) {
    return "bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-slate-100";
  }
  if (direction === LineMessageDirection.OUTBOUND_ADMIN) {
    return "bg-[#0866ff] text-white";
  }
  return "bg-emerald-600 text-white"; // OUTBOUND_AI
}

function directionLabel(direction: LineMessageDirection): string {
  switch (direction) {
    case LineMessageDirection.INBOUND:
      return "ลูกค้า";
    case LineMessageDirection.OUTBOUND_ADMIN:
      return "แอดมิน";
    case LineMessageDirection.OUTBOUND_AI:
      return "AI (จูน)";
    default:
      return "ระบบ";
  }
}

export default async function MessengerConversationDetailPage({ params }: PageProps) {
  const session = await requirePermission("messenger_conversations.view");
  const { id } = await params;
  const data = await getMessengerConversationMessages({ conversationId: id, take: 100 });
  if (!data) notFound();

  const { conversation, messages } = data;
  const canReply = hasPermissionAccess(session.user.role, session.user.permissions, "messenger_conversations.reply");
  const canManage = hasPermissionAccess(session.user.role, session.user.permissions, "messenger_conversations.manage");

  return (
    <div className="space-y-4">
      <Link
        href="/admin/messenger-conversations"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft size={16} /> กลับไปรายการ
      </Link>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
        <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
          {conversation.customer?.name ?? conversation.displayName ?? conversation.psid}
        </h1>
        <p className="mt-1 font-mono text-xs text-gray-500 dark:text-slate-400">{conversation.psid}</p>
        {conversation.customer?.phone ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{conversation.customer.phone}</p>
        ) : null}
      </div>

      <MessengerConversationPanel
        conversationId={conversation.id}
        currentStatus={conversation.aiStatus}
        canManage={canManage}
        canReply={canReply}
      />

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">ยังไม่มีข้อความ</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex flex-col gap-1 ${bubbleAlignment(message.direction)}`}>
              <span className="text-xs text-gray-400 dark:text-slate-500">
                {directionLabel(message.direction)} ·{" "}
                {formatDateTimeThai(message.createdAt, { dateStyle: "short", timeStyle: "short" })}
              </span>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${bubbleStyle(message.direction)}`}>
                {message.text ? <p className="whitespace-pre-wrap">{message.text}</p> : null}
                {message.imageUrl ? (
                  <p className="mt-1 text-xs opacity-80">[รูปภาพ]</p>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
