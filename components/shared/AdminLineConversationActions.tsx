"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Pause, Play, Send, UserRoundCheck, XCircle } from "lucide-react";

type Props = {
  conversationId: string;
  canReply: boolean;
  canManage: boolean;
};

async function postJson(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `REQUEST_FAILED_${response.status}`);
  }
}

export default function AdminLineConversationActions({
  conversationId,
  canReply,
  canManage,
}: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: string, path: string, body?: unknown) => {
    setPending(action);
    setError(null);
    try {
      await postJson(path, body);
      if (action === "send") setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_FAILED");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70">
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() =>
              runAction(
                "pause",
                `/api/admin/line-conversations/${conversationId}/pause-ai`,
                { reason: "PAUSED_FROM_ADMIN_UI" },
              )
            }
            className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Pause size={15} />
            Pause AI
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => runAction("resume", `/api/admin/line-conversations/${conversationId}/resume-ai`)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Play size={15} />
            Resume AI
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() =>
              runAction(
                "waiting",
                `/api/admin/line-conversations/${conversationId}/mark-waiting-admin`,
                { reason: "WAITING_ADMIN_FROM_UI" },
              )
            }
            className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 px-3 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-400/30 dark:text-amber-200 dark:hover:bg-amber-500/10"
          >
            <UserRoundCheck size={15} />
            Waiting admin
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => runAction("close", `/api/admin/line-conversations/${conversationId}/close`)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-200 dark:hover:bg-red-500/10"
          >
            <XCircle size={15} />
            Close
          </button>
        </div>
      ) : null}

      {canReply ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="Type admin reply"
            className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled={pending !== null || text.trim().length === 0}
            onClick={() =>
              runAction("send", `/api/admin/line-conversations/${conversationId}/send-message`, { text })
            }
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            <Send size={15} />
            Send via LINE
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">
          <CheckCircle2 size={15} className="rotate-45" />
          {error}
        </div>
      ) : null}
    </div>
  );
}
