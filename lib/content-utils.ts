import {
  formatDateTimeLocalForInput,
  formatDateTimeThai,
  THAILAND_UTC_OFFSET,
} from "@/lib/th-date";

export function parseBangkokDateTimeLocal(value: string | null | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}:00${THAILAND_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTimeLocal(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return formatDateTimeLocalForInput(date);
}

export function formatThaiDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDateTimeThai(date, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
