import { getThailandDateKey, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type DeliverySaleDateFilter = {
  gte?: Date;
  lte?: Date;
};

export type DeliveryDateRange = {
  /** Normalized `ตั้งแต่` date key (YYYY-MM-DD) — empty string when not filtering. */
  fromKey: string;
  /** Normalized `ถึง` date key (YYYY-MM-DD) — empty string when not filtering. */
  toKey: string;
  /** Prisma filter for `Sale.saleDate` — undefined when both ends are empty. */
  saleDateFilter?: DeliverySaleDateFilter;
  /**
   * True when `fromKey` came from the `ส่งแล้ว` default (today) instead of the URL.
   * Tab links must not propagate it, otherwise the default would leak into the
   * open-queue tabs and hide older pending bills.
   */
  isDefaultFrom: boolean;
};

const normalizeDateKey = (value: string | undefined) =>
  value && DATE_KEY_PATTERN.test(value) ? value : "";

/**
 * Resolves the delivery queue date range filter (both /admin/delivery and
 * /admin/delivery/update filter on `Sale.saleDate`).
 *
 * Default: `ตั้งแต่` = today only on the `ส่งแล้ว` tab, and only when the field
 * has never been submitted (`from === undefined`). An explicitly cleared field
 * arrives as an empty string, which must stay empty so the user can see every
 * delivered bill.
 */
export const resolveDeliveryDateRange = ({
  status,
  from,
  to,
}: {
  status?: string;
  from?: string;
  to?: string;
}): DeliveryDateRange => {
  const isDefaultFrom = from === undefined && status === "DELIVERED";
  const fromKey = isDefaultFrom ? getThailandDateKey() : normalizeDateKey(from);
  const toKey = normalizeDateKey(to);

  if (!fromKey && !toKey) {
    return { fromKey, toKey, isDefaultFrom };
  }

  return {
    fromKey,
    toKey,
    isDefaultFrom,
    saleDateFilter: {
      ...(fromKey ? { gte: parseDateOnlyToStartOfDay(fromKey) } : {}),
      ...(toKey ? { lte: parseDateOnlyToEndOfDay(toKey) } : {}),
    },
  };
};

/** Appends non-empty date keys so tab/pagination links keep the active range. */
export const appendDeliveryDateParams = (
  params: URLSearchParams,
  { fromKey, toKey }: { fromKey: string; toKey: string },
) => {
  if (fromKey) params.set("from", fromKey);
  if (toKey) params.set("to", toKey);
  return params;
};
