import PaginationClient, { type PaginationItem } from "./PaginationClient";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath?: string;
  searchParams?: Record<string, string>;
  buildHref?: (page: number) => string;
  /** When provided, click handler calls this instead of router.push (keeps href for SEO/right-click) */
  onNavigate?: (page: number) => void;
  /** External pending state (overrides internal useTransition) */
  isPending?: boolean;
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
  onNavigate,
  isPending,
}: PaginationProps) => {
  if (totalPages <= 1) return null;

  const hrefFor = (page: number): string => {
    if (buildHref) return buildHref(page);
    return buildUrl(basePath ?? "", page, searchParams);
  };

  const delta = 2;
  const rangeStart = Math.max(1, currentPage - delta);
  const rangeEnd = Math.min(totalPages, currentPage + delta);

  const items: PaginationItem[] = [];

  if (rangeStart > 1) {
    items.push({ kind: "page", page: 1, href: hrefFor(1) });
    if (rangeStart > 2) items.push({ kind: "ellipsis" });
  }

  for (let p = rangeStart; p <= rangeEnd; p += 1) {
    items.push({ kind: "page", page: p, href: hrefFor(p) });
  }

  if (rangeEnd < totalPages) {
    if (rangeEnd < totalPages - 1) items.push({ kind: "ellipsis" });
    items.push({ kind: "page", page: totalPages, href: hrefFor(totalPages) });
  }

  const prevHref = currentPage > 1 ? hrefFor(currentPage - 1) : null;
  const nextHref = currentPage < totalPages ? hrefFor(currentPage + 1) : null;

  return (
    <PaginationClient
      currentPage={currentPage}
      items={items}
      prevHref={prevHref}
      nextHref={nextHref}
      onNavigate={onNavigate}
      isPending={isPending}
    />
  );
};

export default Pagination;
