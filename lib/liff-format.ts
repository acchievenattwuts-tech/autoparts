import {
  addThailandDays,
  formatDateOnlyForInput,
  getThailandDateKey,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

export function formatLiffMoney(value: unknown) {
  return Number(value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function addDays(date: Date, days: number) {
  return addThailandDays(date, days);
}

export function isBeforeToday(date: Date) {
  const today = parseDateOnlyToStartOfDay(getThailandDateKey());
  const compareDate = parseDateOnlyToStartOfDay(formatDateOnlyForInput(date));
  return compareDate < today;
}
