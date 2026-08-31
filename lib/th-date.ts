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

function getThailandDatePart(date: Date, part: DatePart): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: THAILAND_TIME_ZONE,
      [part]: "numeric",
      hour12: false,
    })
      .formatToParts(date)
      .find((item) => item.type === part)?.value ?? ""
  );
}

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
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: THAILAND_TIME_ZONE,
    weekday: "short",
  }).format(toDate(value));
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

  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", formatterOptions).format(toDate(value));
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

  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", formatterOptions).format(toDate(value));
}
