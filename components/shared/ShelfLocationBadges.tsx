import { cn } from "@/lib/utils";

/**
 * The one way every admin page shows where a product is kept: the home (ที่เก็บประจำ)
 * as a solid badge, overflow locations (ที่เก็บเพิ่ม) as outlined "+Z-1" badges after it.
 * Server-safe and display-only; ShelfLocationBadgeMenu adds the manage actions.
 */

export type ShelfLocationBadgeItem = {
  id: string;
  code: string;
  isPrimary: boolean;
  note: string | null;
};

type ShelfLocationBadgesProps = {
  locations: readonly ShelfLocationBadgeItem[];
  size?: "sm" | "md";
  emptyLabel?: string;
  className?: string;
};

const sizeClass = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
} as const;

export const shelfBadgeClassName = (isPrimary: boolean, size: "sm" | "md" = "sm"): string =>
  cn(
    "inline-flex items-center gap-1 rounded-md border font-mono font-semibold leading-5 tabular-nums",
    sizeClass[size],
    isPrimary
      ? "border-[#1e3a5f] bg-[#1e3a5f] text-white dark:border-sky-400/60 dark:bg-sky-500/25 dark:text-sky-100"
      : "border-dashed border-[#1e3a5f]/50 bg-white text-[#1e3a5f] dark:border-sky-400/50 dark:bg-transparent dark:text-sky-200",
  );

export const formatShelfBadgeLabel = (location: Pick<ShelfLocationBadgeItem, "code" | "isPrimary">): string =>
  location.isPrimary ? location.code : `+${location.code}`;

export const shelfBadgeTitle = (location: ShelfLocationBadgeItem): string =>
  `${location.isPrimary ? "ที่เก็บประจำ" : "ที่เก็บเพิ่ม"} ${location.code}${location.note ? ` · ${location.note}` : ""}`;

const ShelfLocationBadges = ({ locations, size = "sm", emptyLabel = "ยังไม่มีที่เก็บ", className }: ShelfLocationBadgesProps) => {
  if (locations.length === 0) {
    return <span className={cn("text-xs text-gray-400 dark:text-slate-500", className)}>{emptyLabel}</span>;
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {locations.map((location) => (
        <span key={location.id} className={shelfBadgeClassName(location.isPrimary, size)} title={shelfBadgeTitle(location)}>
          {formatShelfBadgeLabel(location)}
        </span>
      ))}
    </span>
  );
};

export default ShelfLocationBadges;
