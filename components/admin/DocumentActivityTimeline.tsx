import Link from "next/link";
import { Ban, FilePlus2, Pencil, Route, RotateCw } from "lucide-react";

import type { DocumentActivityEvent, DocumentActivityTone } from "@/lib/document-activity";
import { formatDateTimeThai } from "@/lib/th-date";

/**
 * "default" = wide 3-column grid (time | icon | content).
 * "compact" = single rail with the timestamp stacked above the title,
 *             for narrow side columns (~380px) where the wide grid squeezes
 *             the content column down to an unreadable width.
 */
type DocumentActivityTimelineVariant = "default" | "compact";

type Props = {
  events: DocumentActivityEvent[];
  variant?: DocumentActivityTimelineVariant;
  className?: string;
};

const toneClass: Record<DocumentActivityTone, string> = {
  create: "bg-emerald-500 text-white",
  update: "bg-amber-500 text-white",
  cancel: "bg-rose-500 text-white",
  used: "bg-sky-500 text-white",
  system: "bg-violet-500 text-white",
};

function ActivityIcon({ tone }: { tone: DocumentActivityTone }) {
  if (tone === "create") return <FilePlus2 size={15} />;
  if (tone === "update") return <Pencil size={15} />;
  if (tone === "cancel") return <Ban size={15} />;
  if (tone === "system") return <RotateCw size={15} />;
  return <Route size={15} />;
}

export default function DocumentActivityTimeline({
  events,
  variant = "default",
  className = "mb-6",
}: Props) {
  const isCompact = variant === "compact";

  return (
    <section
      className={`rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e] ${className}`}
    >
      <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-white/10">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-200">
          ประวัติเอกสาร
        </h2>
        <span className="text-xs text-gray-500 dark:text-slate-400">
          {events.length.toLocaleString("th-TH")} เหตุการณ์
        </span>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
          ยังไม่มีประวัติสำหรับเอกสารนี้
        </div>
      ) : (
        <ol className="space-y-0">
          {events.map((event, index) => (
            <li
              key={event.id}
              className={
                isCompact
                  ? "relative pb-5 pl-11 last:pb-0"
                  : "relative grid grid-cols-[5.5rem_2rem_1fr] gap-3 pb-5 last:pb-0 sm:grid-cols-[7rem_2rem_1fr]"
              }
            >
              {index < events.length - 1 ? (
                <span
                  className={
                    isCompact
                      ? "absolute bottom-0 left-4 top-8 w-px -translate-x-1/2 bg-gray-300 dark:bg-slate-500"
                      : "absolute bottom-0 left-[7.25rem] top-8 w-px -translate-x-1/2 bg-gray-300 dark:bg-slate-500 sm:left-[8.75rem]"
                  }
                />
              ) : null}
              {isCompact ? null : (
                <time className="pt-1 text-right text-xs leading-5 text-gray-500 dark:text-slate-400">
                  {formatDateTimeThai(event.occurredAt)}
                </time>
              )}
              <span
                className={`z-10 flex h-8 w-8 items-center justify-center rounded-full ${toneClass[event.tone]} ${
                  isCompact ? "absolute left-0 top-0" : "relative"
                }`}
              >
                <ActivityIcon tone={event.tone} />
              </span>
              <div className="min-w-0 pt-0.5">
                {isCompact ? (
                  <time className="mb-0.5 block text-xs leading-5 text-gray-500 dark:text-slate-400">
                    {formatDateTimeThai(event.occurredAt)}
                  </time>
                ) : null}
                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  {event.title}
                  {event.href && event.hrefLabel ? (
                    <>
                      {" "}
                      <Link
                        href={event.href}
                        className="font-mono text-[#1e3a5f] underline-offset-2 hover:underline dark:text-sky-300 dark:hover:text-sky-200"
                      >
                        {event.hrefLabel}
                      </Link>
                    </>
                  ) : null}
                </p>
                {event.description ? (
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    {event.description}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
