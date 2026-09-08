"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent } from "react";

export type ProfitPaginationItem =
  | { kind: "page"; page: number; href: string }
  | { kind: "ellipsis" };

type ProfitSectionPaginationClientProps = {
  currentPage: number;
  totalPages: number;
  items: ProfitPaginationItem[];
  prevHref: string | null;
  nextHref: string | null;
};

const stepClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5";

/**
 * ช่องสปินเนอร์ความกว้างคงที่ที่ render อยู่ตลอดแล้วสลับแค่ opacity ตามแบบ TabsBar
 * ปุ่ม ก่อนหน้า/ถัดไป จึงไม่ขยับตอนสถานะเปลี่ยน
 */
function StepPendingIndicator({ pending }: { pending: boolean }) {
  return (
    <span
      aria-hidden={!pending}
      className={`inline-flex h-3 w-3 items-center justify-center transition-opacity ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    >
      <LoaderCircle size={12} className="animate-spin" />
    </span>
  );
}

/**
 * แบ่งหน้าแบบ client เพื่อให้มีสถานะ loading ตอนกด: useTransition รู้ว่า RSC payload
 * ของหน้าใหม่มาถึงหรือยัง ซึ่ง <Link> เปล่า ๆ บอกไม่ได้ และ <Suspense> ของ section ก็
 * ไม่โชว์ skeleton ระหว่าง transition (React คงเนื้อหาเดิมไว้) จึงต้องมี feedback ตรงนี้
 */
const ProfitSectionPaginationClient = ({
  currentPage,
  totalPages,
  items,
  prevHref,
  nextHref,
}: ProfitSectionPaginationClientProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingPage, setPendingPage] = useState<number | null>(null);

  const navigate =
    (href: string, page: number) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }

      event.preventDefault();
      if (isPending) return;

      setPendingPage(page);
      startTransition(() => {
        router.push(href, { scroll: false });
      });
    };

  const isLoadingPage = (page: number) => isPending && pendingPage === page;

  return (
    <div
      aria-busy={isPending}
      className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/10 ${
        isPending ? "cursor-wait opacity-60" : ""
      }`}
    >
      <p className="text-xs text-gray-500">
        หน้า {currentPage} จาก {totalPages}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {prevHref ? (
          <Link
            href={prevHref}
            scroll={false}
            onClick={navigate(prevHref, currentPage - 1)}
            className={stepClass}
            rel="prev"
          >
            <StepPendingIndicator pending={isLoadingPage(currentPage - 1)} />
            ก่อนหน้า
          </Link>
        ) : null}
        {items.map((item, index) =>
          item.kind === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="px-1 text-xs text-gray-400">
              ...
            </span>
          ) : (
            <Link
              key={item.page}
              href={item.href}
              scroll={false}
              onClick={navigate(item.href, item.page)}
              aria-current={item.page === currentPage ? "page" : undefined}
              className={`inline-flex min-w-[36px] items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium ${
                item.page === currentPage
                  ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-950"
                  : "border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
              }`}
            >
              {isLoadingPage(item.page) ? (
                <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                item.page
              )}
            </Link>
          ),
        )}
        {nextHref ? (
          <Link
            href={nextHref}
            scroll={false}
            onClick={navigate(nextHref, currentPage + 1)}
            className={stepClass}
            rel="next"
          >
            ถัดไป
            <StepPendingIndicator pending={isLoadingPage(currentPage + 1)} />
          </Link>
        ) : null}
      </div>
    </div>
  );
};

export default ProfitSectionPaginationClient;
