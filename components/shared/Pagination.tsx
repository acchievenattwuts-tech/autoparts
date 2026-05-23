import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath?: string;
  searchParams?: Record<string, string>;
  buildHref?: (page: number) => string;
}

const buildUrl = (
  basePath: string,
  page: number,
  searchParams?: Record<string, string>,
): string => {
  const params = new URLSearchParams(searchParams ?? {});
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
};

const Pagination = ({
  currentPage,
  totalPages,
  basePath,
  searchParams,
  buildHref,
}: PaginationProps) => {
  const hrefFor = (page: number): string => {
    if (buildHref) return buildHref(page);
    return buildUrl(basePath ?? "", page, searchParams);
  };
  if (totalPages <= 1) return null;

  const delta = 2;
  const rangeStart = Math.max(1, currentPage - delta);
  const rangeEnd = Math.min(totalPages, currentPage + delta);

  const pages: number[] = [];
  for (let i = rangeStart; i <= rangeEnd; i++) {
    pages.push(i);
  }

  const isPrevDisabled = currentPage <= 1;
  const isNextDisabled = currentPage >= totalPages;

  const baseLinkClass =
    "inline-flex items-center justify-center min-w-[36px] h-9 px-3 rounded-full text-sm font-semibold transition-colors";
  const activeClass = "bg-[#1e3a5f] text-white shadow-sm";
  const inactiveClass =
    "bg-white border border-gray-200 text-[#1e3a5f] hover:border-[#1e3a5f] hover:bg-[#1e3a5f]/5 dark:bg-white/5 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10";
  const disabledClass =
    "bg-gray-50 border border-gray-100 text-gray-300 pointer-events-none dark:bg-white/5 dark:border-white/10 dark:text-slate-600";
  const ellipsisClass =
    "inline-flex items-center justify-center min-w-[28px] h-9 text-sm text-gray-400 dark:text-slate-500";

  return (
    <nav aria-label="แบ่งหน้า" className="mt-4 flex items-center justify-center gap-1.5 py-2 sm:gap-2">
      {isPrevDisabled ? (
        <span className={`${baseLinkClass} ${disabledClass}`} aria-hidden="true">
          <span aria-hidden="true">‹</span>
          <span className="ml-1 hidden sm:inline">ก่อนหน้า</span>
        </span>
      ) : (
        <Link
          href={hrefFor(currentPage - 1)}
          className={`${baseLinkClass} ${inactiveClass}`}
          aria-label="หน้าก่อนหน้า"
          rel="prev"
        >
          <span aria-hidden="true">‹</span>
          <span className="ml-1 hidden sm:inline">ก่อนหน้า</span>
        </Link>
      )}

      {rangeStart > 1 && (
        <>
          <Link href={hrefFor(1)} className={`${baseLinkClass} ${inactiveClass}`}>1</Link>
          {rangeStart > 2 && <span className={ellipsisClass}>…</span>}
        </>
      )}

      {pages.map((p) => (
        <Link
          key={p}
          href={hrefFor(p)}
          aria-current={p === currentPage ? "page" : undefined}
          className={`${baseLinkClass} ${p === currentPage ? activeClass : inactiveClass}`}
        >
          {p}
        </Link>
      ))}

      {rangeEnd < totalPages && (
        <>
          {rangeEnd < totalPages - 1 && <span className={ellipsisClass}>…</span>}
          <Link href={hrefFor(totalPages)} className={`${baseLinkClass} ${inactiveClass}`}>
            {totalPages}
          </Link>
        </>
      )}

      {isNextDisabled ? (
        <span className={`${baseLinkClass} ${disabledClass}`} aria-hidden="true">
          <span className="mr-1 hidden sm:inline">ถัดไป</span>
          <span aria-hidden="true">›</span>
        </span>
      ) : (
        <Link
          href={hrefFor(currentPage + 1)}
          className={`${baseLinkClass} ${inactiveClass}`}
          aria-label="หน้าถัดไป"
          rel="next"
        >
          <span className="mr-1 hidden sm:inline">ถัดไป</span>
          <span aria-hidden="true">›</span>
        </Link>
      )}
    </nav>
  );
};

export default Pagination;
