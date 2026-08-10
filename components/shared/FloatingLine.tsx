"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageCircleMore, Phone, X } from "lucide-react";

/**
 * Floating contact launcher.
 *
 * A single primary button that expands into the shop's contact channels
 * (LINE and phone). Collapsed by default with a short prompt beside it, so the
 * corner stays quiet until a customer actually needs help.
 */

const PROMPT_TEXT = "หาอะไหล่ไม่เจอ ทักได้เลยค่ะ";

const LINE_ICON = (
  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
  </svg>
);

interface Channel {
  key: string;
  label: string;
  href: string;
  /** External links open in a new tab; tel: links must not. */
  external: boolean;
  icon: ReactNode;
  className: string;
}

interface Props {
  lineUrl?: string;
  shopPhone?: string;
}

const FloatingLine = ({ lineUrl = "", shopPhone = "" }: Props) => {
  const [open, setOpen] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape, the way any popover should behave.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && !containerRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const channels: Channel[] = [];
  if (lineUrl) {
    channels.push({
      key: "line",
      label: "แชททาง LINE",
      href: lineUrl,
      external: true,
      icon: LINE_ICON,
      className: "bg-[#06C755] hover:bg-[#05a847] shadow-[#06C755]/35",
    });
  }
  if (shopPhone) {
    channels.push({
      key: "phone",
      label: `โทร ${shopPhone}`,
      href: `tel:${shopPhone}`,
      external: false,
      icon: <Phone className="h-5 w-5" />,
      className: "bg-[#1e3a5f] hover:bg-[#163055] shadow-[#1e3a5f]/35",
    });
  }

  if (channels.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-5 right-4 z-50 flex flex-col items-end gap-2.5 sm:bottom-6 sm:right-6"
    >
      {/* Channels — stacked above the launcher, revealed on open */}
      <div
        className={`flex flex-col items-end gap-2.5 transition-all duration-200 ${
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0"
        } motion-reduce:transition-none`}
        aria-hidden={!open}
      >
        {channels.map((channel, index) => (
          <a
            key={channel.key}
            href={channel.href}
            target={channel.external ? "_blank" : undefined}
            rel={channel.external ? "noopener noreferrer" : undefined}
            tabIndex={open ? 0 : -1}
            style={{ transitionDelay: open ? `${index * 45}ms` : "0ms" }}
            className="group/channel flex items-center gap-2.5"
          >
            <span className="rounded-full bg-white/95 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-md ring-1 ring-black/5 backdrop-blur-sm">
              {channel.label}
            </span>
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-transform group-hover/channel:scale-110 motion-reduce:transform-none ${channel.className}`}
            >
              {channel.icon}
            </span>
          </a>
        ))}
      </div>

      <div className="flex items-center gap-2.5">
        {/* Prompt bubble — collapsed state only, dismissible */}
        {!open && !promptDismissed && (
          <div className="flex max-w-[15rem] items-center gap-1.5 rounded-2xl border border-slate-100 bg-white py-2 pl-3.5 pr-1.5 shadow-lg">
            <p className="text-sm font-medium leading-snug text-slate-700">{PROMPT_TEXT}</p>
            <button
              type="button"
              onClick={() => setPromptDismissed(true)}
              aria-label="ปิดข้อความ"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={open ? "ปิดช่องทางติดต่อ" : "เปิดช่องทางติดต่อ"}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2563eb]/30 motion-reduce:transform-none ${
            open ? "bg-slate-700 shadow-slate-700/30" : "bg-[#06C755] shadow-[#06C755]/40"
          }`}
        >
          {/* Attention pulse, only while collapsed */}
          {!open && (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-ping rounded-full bg-[#06C755] opacity-20 motion-reduce:animate-none"
            />
          )}
          <span className="relative">
            {open ? <X className="h-6 w-6" /> : <MessageCircleMore className="h-7 w-7" />}
          </span>
        </button>
      </div>
    </div>
  );
};

export default FloatingLine;
