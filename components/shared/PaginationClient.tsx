"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type MouseEvent } from "react";

export type PaginationItem =
  | { kind: "page"; page: number; href: string }
  | { kind: "ellipsis" };

interface PaginationClientProps {
  currentPage: number;
  items: PaginationItem[];
  prevHref: string | null;
  nextHref: string | null;
}

const Spinner = () => (
  <svg
    className="h-3.5 w-3.5 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="3"
      strokeOpacity="0.25"
    />
    <path
      d="M22 12a10 10 0 0 1-10 10"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

const baseLinkClass =
  "inline-flex items-center justify-center min-w-[36px] h-9 px-3 rounded-full text-sm font-semibold transition-colors";
const activeClass = "bg-[#1e3a5f] text-white shadow-sm";
const inactiveClass =
  "bg-white border border-gray-200 text-[#1e3a5f] hover:border-[#1e3a5f] hover:bg-[#1e3a5f]/5 dark:bg-white/5 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10";
const disabledClass =
  "bg-gray-50 border border-gray-100 text-gray-300 pointer-events-none dark:bg-white/5 dark:border-white/10 dark:text-slate-600";
const pendingClass = "opacity-60 cursor-wait";
const ellipsisClass =
  "inline-flex items-center justify-center min-w-[28px] h-9 text-sm text-gray-400 dark:text-slate-500";

const PaginationClient = ({
  currentPage,
  items,
  prevHref,
  nextHref,
}: PaginationClientProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate =
    (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      if (isPending) return;
      startTransition(() => router.push(href));
    };

  const wrapperClass = `mt-4 flex items-center justify-center gap-1.5 py-2 sm:gap-2 ${
    isPending ? pendingClass : ""
  }`;

  return (
    <nav aria-label="แบ่งหน้า" aria-busy={isPending} className={wrapperClass}>
      {prevHref ? (
        <Link
          href={prevHref}
          onClick={navigate(prevHref)}
          className={`${baseLinkClass} ${inactiveClass}`}
          aria-label="หน้าก่อนหน้า"
          rel="prev"
        >
          <span aria-hidden="true">‹</span>
          <span className="ml-1 hidden sm:inline">ก่อนหน้า</span>
        </Link>
      ) : (
        <span className={`${baseLinkClass} ${disabledClass}`} aria-hidden="true">
          <span aria-hidden="true">‹</span>
          <span className="ml-1 hidden sm:inline">ก่อนหน้า</span>
        </span>
      )}

      {items.map((item, idx) => {
        if (item.kind === "ellipsis") {
          return (
            <span key={`e-${idx}`} className={ellipsisClass}>
              …
            </span>
          );
        }
        const isCurrent = item.page === currentPage;
        return (
          <Link
            key={item.page}
            href={item.href}
            onClick={navigate(item.href)}
            aria-current={isCurrent ? "page" : undefined}
            className={`${baseLinkClass} ${isCurrent ? activeClass : inactiveClass}`}
          >
            {isPending && isCurrent ? <Spinner /> : item.page}
          </Link>
        );
      })}

      {nextHref ? (
        <Link
          href={nextHref}
          onClick={navigate(nextHref)}
          className={`${baseLinkClass} ${inactiveClass}`}
          aria-label="หน้าถัดไป"
          rel="next"
        >
          <span className="mr-1 hidden sm:inline">ถัดไป</span>
          <span aria-hidden="true">›</span>
        </Link>
      ) : (
        <span className={`${baseLinkClass} ${disabledClass}`} aria-hidden="true">
          <span className="mr-1 hidden sm:inline">ถัดไป</span>
          <span aria-hidden="true">›</span>
        </span>
      )}
    </nav>
  );
};

export default PaginationClient;
