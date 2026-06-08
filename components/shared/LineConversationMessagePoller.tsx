"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type LineConversationMessagePollerProps = {
  conversationId: string;
  latestMessageId: string | null;
  pollMs?: number;
};

type LatestMessagesResponse = {
  messages?: Array<{ id?: string | null }>;
};

export default function LineConversationMessagePoller({
  conversationId,
  latestMessageId,
  pollMs = 5000,
}: LineConversationMessagePollerProps) {
  const router = useRouter();
  const latestMessageIdRef = useRef(latestMessageId);
  const inFlightRef = useRef(false);

  useEffect(() => {
    latestMessageIdRef.current = latestMessageId;
  }, [latestMessageId]);

  useEffect(() => {
    let stopped = false;

    const checkLatestMessage = async () => {
      if (stopped || inFlightRef.current || document.visibilityState === "hidden") return;

      inFlightRef.current = true;
      try {
        const response = await fetch(`/api/admin/line-conversations/${conversationId}/messages?take=1`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const payload = (await response.json()) as LatestMessagesResponse;
        const latestId = payload.messages?.at(-1)?.id ?? null;

        if (latestId && latestId !== latestMessageIdRef.current) {
          latestMessageIdRef.current = latestId;
          router.refresh();
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    const handleVisibleCheck = () => {
      if (document.visibilityState === "visible") void checkLatestMessage();
    };

    const intervalId = window.setInterval(() => void checkLatestMessage(), pollMs);
    window.addEventListener("focus", handleVisibleCheck);
    document.addEventListener("visibilitychange", handleVisibleCheck);
    void checkLatestMessage();

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibleCheck);
      document.removeEventListener("visibilitychange", handleVisibleCheck);
    };
  }, [conversationId, pollMs, router]);

  return null;
}
