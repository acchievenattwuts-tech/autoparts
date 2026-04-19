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

export function getThailandDateKey(value: Date = new Date()): string {
  const year = getThailandDatePart(value, "year");
  const month = getThailandDatePart(value, "month").padStart(2, "0");
  const day = getThailandDatePart(value, "day").padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getThailandMonthStartDateKey(value: Date = new Date()): string {
  const year = getThailandDatePart(value, "year");
  const month = getThailandDatePart(value, "month").padStart(2, "0");
  return `${year}-${month}-01`;
}

export function formatDateOnlyForInput(value: DateInput): string {
  if (typeof value === "string" && isDateOnlyString(value)) {
    return value;
  }

  return getThailandDateKey(toDate(value));
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
