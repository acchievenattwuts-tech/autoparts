import type { ReactNode } from "react";

/**
 * Shared loading shell for every /admin/knowledge segment.
 *
 * The knowledge pages render their own header + tab bar inside the page body
 * (not in a layout), so each loading.tsx has to draw both or the tab bar
 * disappears during navigation and the content jumps when it returns.
 */

const cardClass =
  "rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/80";
const barClass = "rounded bg-slate-200 dark:bg-white/10";

/** Matches the six pills rendered by KnowledgeTabs. */
const TAB_PILL_WIDTHS = ["w-28", "w-24", "w-28", "w-20", "w-24", "w-24"];

export const SkeletonStatCards = ({ count = 4 }: { count?: number }) => (
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className={`h-24 animate-pulse p-4 ${cardClass}`}>
        <div className={`h-3 w-32 ${barClass}`} />
        <div className={`mt-4 h-6 w-20 ${barClass}`} />
      </div>
    ))}
  </div>
);

export const SkeletonTable = ({ rows = 8 }: { rows?: number }) => (
  <div className={`animate-pulse overflow-hidden ${cardClass}`}>
    <div className="h-11 border-b border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5" />
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={index}
        className="h-12 border-t border-slate-100 first:border-t-0 dark:border-white/5"
      />
    ))}
  </div>
);

const KnowledgeLoadingSkeleton = ({
  label,
  showTabs = true,
  children,
}: {
  label: string;
  /** Editor pages (new / detail) render a header without the tab bar. */
  showTabs?: boolean;
  children?: ReactNode;
}) => (
  <div className="space-y-5" aria-busy="true" aria-label={label}>
    <div className="animate-pulse space-y-2">
      <div className={`h-3 w-28 ${barClass}`} />
      <div className={`h-7 w-64 ${barClass}`} />
      <div className={`h-3 w-full max-w-xl ${barClass}`} />
    </div>

    {showTabs && (
      <div
        className={`flex gap-2 overflow-hidden p-2 ${cardClass}`}
        aria-hidden="true"
      >
        {TAB_PILL_WIDTHS.map((width) => (
          <div
            key={width}
            className={`h-9 flex-shrink-0 animate-pulse rounded-lg ${width} bg-slate-200 dark:bg-white/10`}
          />
        ))}
      </div>
    )}

    {children ?? <div className={`h-72 animate-pulse ${cardClass}`} />}
  </div>
);

export default KnowledgeLoadingSkeleton;
