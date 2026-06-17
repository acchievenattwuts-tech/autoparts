"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ImagePlus,
  LoaderCircle,
  Pause,
  Play,
  Send,
  Smile,
  UserRoundCheck,
  X,
  XCircle,
} from "lucide-react";

import { LINE_AI_DRAFT_USE_EVENT } from "@/components/shared/LineAiDraftUseButton";

type Props = {
  conversationId: string;
  canReply: boolean;
  canManage: boolean;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const QUICK_EMOJIS = [
  "😀",
  "😁",
  "😊",
  "🙏",
  "👍",
  "👌",
  "❤️",
  "🎉",
  "✨",
  "🚗",
  "🔧",
  "❄️",
  "📦",
  "💰",
  "✅",
  "❌",
  "📍",
  "📞",
  "⏰",
  "ขอบคุณครับ",
];

const ERROR_MESSAGES: Record<string, string> = {
  EMPTY_MESSAGE: "กรุณาพิมพ์ข้อความหรือแนบรูปก่อนส่ง",
  EMPTY_IMAGE: "ไม่พบไฟล์รูปภาพ",
  IMAGE_TOO_LARGE: "ขนาดรูปต้องไม่เกิน 5MB",
  UNSUPPORTED_IMAGE_TYPE: "รองรับเฉพาะรูป JPEG, PNG หรือ WebP",
  MESSAGE_TOO_LONG: "ข้อความยาวเกินกำหนด",
  IMAGE_UPLOAD_FAILED: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED: "ยังไม่ได้ตั้งค่า LINE Channel Access Token",
  CONVERSATION_NOT_FOUND: "ไม่พบบทสนทนานี้",
  FORBIDDEN: "ไม่มีสิทธิ์ส่งข้อความ",
  UNAUTHORIZED: "กรุณาเข้าสู่ระบบใหม่",
};

const ACTION_LABELS: Record<string, { idle: string; pending: string }> = {
  pause: { idle: "พัก AI (Pause)", pending: "กำลังพัก AI..." },
  resume: { idle: "เปิด AI ต่อ (Resume)", pending: "กำลังเปิด AI..." },
  waiting: { idle: "รอแอดมิน (Waiting)", pending: "กำลังบันทึก..." },
  close: { idle: "ปิดเคส (Close)", pending: "กำลังปิดเคส..." },
};

function friendlyError(code: string): string {
  return ERROR_MESSAGES[code] ?? "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  useEffect(() => {
    const handleUseDraft = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const draftText = detail?.text;
      if (!draftText) return;
      setText(draftText);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(draftText.length, draftText.length);
      });
    };

    window.addEventListener(LINE_AI_DRAFT_USE_EVENT, handleUseDraft);
    return () => window.removeEventListener(LINE_AI_DRAFT_USE_EVENT, handleUseDraft);
  }, []);

  const clearImage = () => {
    setImageFile(null);
    setImagePreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePickImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setError(friendlyError("IMAGE_TOO_LARGE"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setImageFile(file);
    setImagePreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setText((current) => current + emoji);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    const nextCursor = start + emoji.length;

    setText(nextText);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const runAction = async (action: string, path: string, body?: unknown) => {
    setPending(action);
    setError(null);
    try {
      await postJson(path, body);
      router.refresh();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "REQUEST_FAILED"));
    } finally {
      setPending(null);
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && !imageFile) return;

    setPending("send");
    setError(null);
    try {
      const path = `/api/admin/line-conversations/${conversationId}/send-message`;
      let response: Response;
      if (imageFile) {
        const formData = new FormData();
        formData.set("image", imageFile);
        if (trimmed) formData.set("text", trimmed);
        response = await fetch(path, { method: "POST", body: formData });
      } else {
        response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `REQUEST_FAILED_${response.status}`);
      }

      setText("");
      clearImage();
      router.refresh();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "REQUEST_FAILED"));
    } finally {
      setPending(null);
    }
  };

  const sendDisabled = pending !== null || (text.trim().length === 0 && !imageFile);

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
            {pending === "pause" ? <LoaderCircle size={15} className="animate-spin" /> : <Pause size={15} />}
            {pending === "pause" ? ACTION_LABELS.pause.pending : ACTION_LABELS.pause.idle}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => runAction("resume", `/api/admin/line-conversations/${conversationId}/resume-ai`)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
          >
            {pending === "resume" ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />}
            {pending === "resume" ? ACTION_LABELS.resume.pending : ACTION_LABELS.resume.idle}
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
            {pending === "waiting" ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <UserRoundCheck size={15} />
            )}
            {pending === "waiting" ? ACTION_LABELS.waiting.pending : ACTION_LABELS.waiting.idle}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => runAction("close", `/api/admin/line-conversations/${conversationId}/close`)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-200 dark:hover:bg-red-500/10"
          >
            {pending === "close" ? <LoaderCircle size={15} className="animate-spin" /> : <XCircle size={15} />}
            {pending === "close" ? ACTION_LABELS.close.pending : ACTION_LABELS.close.idle}
          </button>
        </div>
      ) : null}

      {canReply ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="พิมพ์ข้อความตอบลูกค้าผ่าน LINE (แนบรูปได้)"
            className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />

          {imagePreview ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote asset */}
              <img
                src={imagePreview}
                alt="ตัวอย่างรูปที่จะส่ง"
                className="max-h-40 rounded-md border border-gray-200 object-contain dark:border-white/10"
              />
              <button
                type="button"
                onClick={clearImage}
                aria-label="ลบรูป"
                className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white shadow hover:bg-gray-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                <X size={14} />
              </button>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePickImage}
            />
            <div className="relative">
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => setEmojiOpen((open) => !open)}
                aria-expanded={emojiOpen}
                aria-label="เลือกอิโมจิ"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
              >
                <Smile size={16} />
              </button>
              {emojiOpen ? (
                <div className="absolute bottom-11 left-0 z-20 grid w-64 grid-cols-5 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-slate-900">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="inline-flex h-9 min-w-0 items-center justify-center rounded-md px-1 text-lg hover:bg-gray-100 dark:hover:bg-white/10"
                    >
                      <span className="truncate text-center text-sm leading-none">{emoji}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
            >
              <ImagePlus size={15} />
              แนบรูป
            </button>
            <button
              type="button"
              disabled={sendDisabled}
              onClick={handleSend}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
            >
              <Send size={15} />
              {pending === "send" ? "กำลังส่ง…" : "ส่งผ่าน LINE"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">
          <AlertCircle size={15} />
          {error}
        </div>
      ) : null}
    </div>
  );
}
