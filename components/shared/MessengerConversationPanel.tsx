"use client";

import { useState, useTransition } from "react";

import { LineConversationAiStatus } from "@/lib/generated/prisma";
import {
  changeMessengerConversationStatusAction,
  sendMessengerAdminMessageAction,
} from "@/app/admin/(protected)/messenger-conversations/actions";

type Props = {
  conversationId: string;
  currentStatus: LineConversationAiStatus;
  canManage: boolean;
  canReply: boolean;
};

const STATUS_BUTTONS: Array<{ status: LineConversationAiStatus; label: string; className: string }> = [
  { status: LineConversationAiStatus.ACTIVE, label: "เปิด AI", className: "bg-emerald-600 hover:bg-emerald-700" },
  { status: LineConversationAiStatus.PAUSED_BY_ADMIN, label: "พัก AI", className: "bg-amber-600 hover:bg-amber-700" },
  { status: LineConversationAiStatus.WAITING_ADMIN, label: "รอแอดมิน", className: "bg-sky-600 hover:bg-sky-700" },
  { status: LineConversationAiStatus.CLOSED, label: "ปิดเคส", className: "bg-gray-600 hover:bg-gray-700" },
];

const MessengerConversationPanel = ({ conversationId, currentStatus, canManage, canReply }: Props) => {
  const [status, setStatus] = useState<LineConversationAiStatus>(currentStatus);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleStatus = (next: LineConversationAiStatus) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await changeMessengerConversationStatusAction({ conversationId, status: next });
      if (result.ok) {
        setStatus(next);
        setNotice("อัปเดตสถานะแล้ว");
      } else {
        setError(result.error);
      }
    });
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("กรุณาพิมพ์ข้อความก่อนส่ง");
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sendMessengerAdminMessageAction({ conversationId, text: trimmed });
      if (result.ok) {
        setText("");
        setStatus(LineConversationAiStatus.PAUSED_BY_ADMIN);
        setNotice("ส่งข้อความแล้ว (AI ถูกพักอัตโนมัติ)");
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {STATUS_BUTTONS.map((btn) => (
            <button
              key={btn.status}
              type="button"
              disabled={isPending || status === btn.status}
              onClick={() => handleStatus(btn.status)}
              className={`rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-40 ${btn.className}`}
            >
              {btn.label}
              {status === btn.status ? " ✓" : ""}
            </button>
          ))}
        </div>
      ) : null}

      {canReply ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="พิมพ์ข้อความตอบลูกค้า..."
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={handleSend}
            className="rounded-md bg-[#0866ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0757d8] disabled:opacity-40"
          >
            {isPending ? "กำลังส่ง..." : "ส่งข้อความ"}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p> : null}
    </div>
  );
};

export default MessengerConversationPanel;
