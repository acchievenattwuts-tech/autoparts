import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath: string;
  searchParams?: Record<string, string>;
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
}: PaginationProps) => {
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
    "inline-flex items-center justify-center min-w-[32px] h-8 px-2 rounded text-xs font-medium transition-colors";
  const activeClass = "bg-[#1e3a5f] text-white";
  const inactiveClass =
    "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50";
  const disabledClass =
    "bg-white border border-gray-200 text-gray-300 pointer-events-none";

  return (
    <div className="flex items-center justify-center gap-1 mt-4 py-2">
      {isPrevDisabled ? (
        <span className={`${baseLinkClass} ${disabledClass}`}>‹</span>
      ) : (
        <Link
          href={buildUrl(basePath, currentPage - 1, searchParams)}
          className={`${baseLinkClass} ${inactiveClass}`}
        >
          ‹
        </Link>
      )}

      {rangeStart > 1 && (
        <>
          <Link
            href={buildUrl(basePath, 1, searchParams)}
            className={`${baseLinkClass} ${inactiveClass}`}
          >
            1
          </Link>
          {rangeStart > 2 && (
            <span className={`${baseLinkClass} text-gray-400`}>…</span>
          )}
        </>
      )}

      {pages.map((p) => (
        <Link
          key={p}
          href={buildUrl(basePath, p, searchParams)}
          className={`${baseLinkClass} ${
            p === currentPage ? activeClass : inactiveClass
          }`}
        >
          {p}
        </Link>
      ))}

      {rangeEnd < totalPages && (
        <>
          {rangeEnd < totalPages - 1 && (
            <span className={`${baseLinkClass} text-gray-400`}>…</span>
          )}
          <Link
            href={buildUrl(basePath, totalPages, searchParams)}
            className={`${baseLinkClass} ${inactiveClass}`}
          >
            {totalPages}
          </Link>
        </>
      )}

      {isNextDisabled ? (
        <span className={`${baseLinkClass} ${disabledClass}`}>›</span>
      ) : (
        <Link
          href={buildUrl(basePath, currentPage + 1, searchParams)}
          className={`${baseLinkClass} ${inactiveClass}`}
        >
          ›
        </Link>
      )}
    </div>
  );
};

export default Pagination;
