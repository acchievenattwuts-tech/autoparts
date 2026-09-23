export const THAILAND_TIME_ZONE = "Asia/Bangkok";
export const THAILAND_UTC_OFFSET = "+07:00";

type DatePart =
  | "year"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second";

type DateInput = Date | string;

// Constructing an Intl.DateTimeFormat is far more expensive than formatting with
// one, and these helpers run per row in reports/exports. Formatters are
// immutable, so each distinct locale+options set is built once and reused; the
// options passed are exactly the ones used before, so output is unchanged.
const datePartFormatters = new Map<DatePart, Intl.DateTimeFormat>();

function getThailandDatePart(date: Date, part: DatePart): string {
  let formatter = datePartFormatters.get(part);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: THAILAND_TIME_ZONE,
      [part]: "numeric",
      hour12: false,
    });
    datePartFormatters.set(part, formatter);
  }
  return formatter.formatToParts(date).find((item) => item.type === part)?.value ?? "";
}

const MAX_CACHED_DISPLAY_FORMATTERS = 64;
const displayFormatters = new Map<string, Intl.DateTimeFormat>();

type FormatterOptionValue = string | number | boolean | undefined;

/**
 * Cache key for a display formatter, or null when an option value is not a
 * plain primitive (then the caller builds a fresh formatter, as before).
 * Undefined values are left out of the key: Intl treats an undefined option
 * exactly like an absent one.
 */
function getDisplayFormatterKey(options: Intl.DateTimeFormatOptions): string | null {
  const entries: [string, FormatterOptionValue][] = [];
  for (const [key, value] of Object.entries(options) as [string, unknown][]) {
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    entries.push([key, value]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

function getThaiDisplayFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = getDisplayFormatterKey(options);
  const cached = key === null ? undefined : displayFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("th-TH-u-ca-gregory", options);
  if (key !== null && displayFormatters.size < MAX_CACHED_DISPLAY_FORMATTERS) {
    displayFormatters.set(key, formatter);
  }
  return formatter;
}

let weekdayFormatter: Intl.DateTimeFormat | null = null;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function hasStyleOptions(options?: Intl.DateTimeFormatOptions): boolean {
  return Boolean(options?.dateStyle || options?.timeStyle);
}

export function isDateOnlyString(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  return !Number.isNaN(new Date(`${value}T00:00:00${THAILAND_UTC_OFFSET}`).getTime());
}

export function getThailandDateKey(value: DateInput = new Date()): string {
  const date = toDate(value);
  const year = getThailandDatePart(date, "year");
  const month = getThailandDatePart(date, "month").padStart(2, "0");
  const day = getThailandDatePart(date, "day").padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getThailandMonthStartDateKey(value: Date = new Date()): string {
  const year = getThailandDatePart(value, "year");
  const month = getThailandDatePart(value, "month").padStart(2, "0");
  return `${year}-${month}-01`;
}

export function getThailandMonthKey(value: Date = new Date()): string {
  const year = getThailandDatePart(value, "year");
  const month = getThailandDatePart(value, "month").padStart(2, "0");
  return `${year}-${month}`;
}

/** True when `dayKey` (YYYY-MM-DD, Thailand calendar) is the last day of its month. */
export function isThailandMonthEndDateKey(dayKey: string): boolean {
  const date = parseDateOnlyToDate(dayKey);
  return getThailandMonthKey(addThailandDays(date, 1)) !== getThailandMonthKey(date);
}

export function getThailandWeekdayIndex(value: DateInput): number {
  weekdayFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: THAILAND_TIME_ZONE,
    weekday: "short",
  });
  const weekday = weekdayFormatter.format(toDate(value));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

export function formatDateOnlyForInput(value: DateInput): string {
  if (typeof value === "string" && isDateOnlyString(value)) {
    return value;
  }

  return getThailandDateKey(toDate(value));
}

export function formatDateTimeLocalForInput(value: DateInput): string {
  const date = toDate(value);
  const year = getThailandDatePart(date, "year");
  const month = getThailandDatePart(date, "month").padStart(2, "0");
  const day = getThailandDatePart(date, "day").padStart(2, "0");
  const hour = getThailandDatePart(date, "hour").padStart(2, "0");
  const minute = getThailandDatePart(date, "minute").padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function parseDateOnlyToDate(value: string): Date {
  return new Date(`${value}T00:00:00${THAILAND_UTC_OFFSET}`);
}

export function parseDateOnlyToStartOfDay(value: string): Date {
  return new Date(`${value}T00:00:00.000${THAILAND_UTC_OFFSET}`);
}

export function parseDateOnlyToEndOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999${THAILAND_UTC_OFFSET}`);
}

export function startOfThailandDay(value: DateInput): Date {
  return parseDateOnlyToStartOfDay(formatDateOnlyForInput(value));
}

export function addThailandDays(value: DateInput, days: number): Date {
  const date = toDate(value);
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

export function formatDateThai(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const formatterOptions = hasStyleOptions(options)
    ? {
        timeZone: THAILAND_TIME_ZONE,
        ...options,
      }
    : {
        timeZone: THAILAND_TIME_ZONE,
        day: "2-digit" as const,
        month: "2-digit" as const,
        year: "numeric" as const,
        ...options,
      };

  return getThaiDisplayFormatter(formatterOptions).format(toDate(value));
}

export function formatDateTimeThai(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  const formatterOptions = hasStyleOptions(options)
    ? {
        timeZone: THAILAND_TIME_ZONE,
        hour12: false,
        ...options,
      }
    : {
        timeZone: THAILAND_TIME_ZONE,
        day: "2-digit" as const,
        month: "2-digit" as const,
        year: "numeric" as const,
        hour: "2-digit" as const,
        minute: "2-digit" as const,
        hour12: false,
        ...options,
      };

  return getThaiDisplayFormatter(formatterOptions).format(toDate(value));
}
