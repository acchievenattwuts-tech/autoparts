"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";

import { changeLineConversationStatusAction } from "@/app/admin/(protected)/line-conversations/actions";
import {
  getLineConversationContainerClassName,
  getLineConversationCurrentBadgeClassName,
  getLineConversationDropdownClassName,
  getLineConversationMenuItemClassName,
} from "@/components/shared/line-conversation-status-switcher-styles";
import { LineConversationAiStatus } from "@/lib/generated/prisma";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<LineConversationAiStatus, string> = {
  ACTIVE: "AI ทำงาน",
  PAUSED_BY_ADMIN: "พัก AI",
  WAITING_ADMIN: "รอแอดมิน",
  CLOSED: "ปิดเคส",
};

const STATUS_CLASSES: Record<LineConversationAiStatus, string> = {
  ACTIVE:
    "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25",
  PAUSED_BY_ADMIN:
    "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25",
  WAITING_ADMIN:
    "bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500/25",
  CLOSED: "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15",
};

const STATUS_ORDER: LineConversationAiStatus[] = [
  LineConversationAiStatus.ACTIVE,
  LineConversationAiStatus.PAUSED_BY_ADMIN,
  LineConversationAiStatus.WAITING_ADMIN,
  LineConversationAiStatus.CLOSED,
];

const CLOSE_CONFIRM_MESSAGE =
  "ปิดเคสนี้? AI จะหยุดทำงานและไม่รับข้อความใหม่จนกว่าจะกลับมาเปิด ยืนยันหรือไม่?";

type Props = {
  conversationId: string;
  currentStatus: LineConversationAiStatus;
};

const LineConversationStatusSwitcher = ({ conversationId, currentStatus }: Props) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LineConversationAiStatus>(currentStatus);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
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
  }, [open]);

  useEffect(() => {
    setStatus(currentStatus);
  }, [currentStatus]);

  const handleChange = (next: LineConversationAiStatus) => {
    setOpen(false);
    setErrorMsg(null);
    if (next === status) return;

    if (next === LineConversationAiStatus.CLOSED) {
      if (!window.confirm(CLOSE_CONFIRM_MESSAGE)) return;
    }

    const previous = status;
    setStatus(next);
    startTransition(async () => {
      const result = await changeLineConversationStatusAction({
        conversationId,
        status: next,
      });
      if (!result.ok) {
        setStatus(previous);
        setErrorMsg(result.error);
      }
    });
  };

  return (
    <div ref={containerRef} className={getLineConversationContainerClassName(open)}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        disabled={isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-wait",
          STATUS_CLASSES[status],
        )}
      >
        {isPending ? <LoaderCircle size={12} className="animate-spin" /> : null}
        {STATUS_LABELS[status]}
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          role="menu"
          onClick={(event) => event.stopPropagation()}
          className={getLineConversationDropdownClassName()}
        >
          {STATUS_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.preventDefault();
                handleChange(option);
              }}
              className={getLineConversationMenuItemClassName(option === status)}
            >
              <span>{STATUS_LABELS[option]}</span>
              {option === status ? (
                <span className={getLineConversationCurrentBadgeClassName()}>(ปัจจุบัน)</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {errorMsg ? (
        <p
          className="absolute left-0 top-full mt-1 whitespace-nowrap rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700 shadow dark:bg-red-500/15 dark:text-red-200"
          role="alert"
        >
          {errorMsg}
        </p>
      ) : null}
    </div>
  );
};

export default LineConversationStatusSwitcher;
