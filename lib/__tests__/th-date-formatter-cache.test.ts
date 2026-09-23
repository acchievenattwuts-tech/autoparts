import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDateThai,
  formatDateTimeLocalForInput,
  formatDateTimeThai,
  getThailandDateKey,
  getThailandMonthKey,
  getThailandMonthStartDateKey,
  getThailandWeekdayIndex,
} from "@/lib/th-date";

// Reference = the pre-cache implementation, which built a fresh
// Intl.DateTimeFormat on every call. The cached helpers must return the exact
// same string for every input.
const TZ = "Asia/Bangkok";
type Part = "year" | "month" | "day" | "hour" | "minute";

const refPart = (date: Date, part: Part): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, [part]: "numeric", hour12: false })
    .formatToParts(date)
    .find((item) => item.type === part)?.value ?? "";

const ref = {
  weekday: (date: Date) =>
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date),
    ),
  dateThai: (date: Date, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(
      "th-TH-u-ca-gregory",
      options?.dateStyle || options?.timeStyle
        ? { timeZone: TZ, ...options }
        : { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", ...options },
    ).format(date),
  dateTimeThai: (date: Date, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(
      "th-TH-u-ca-gregory",
      options?.dateStyle || options?.timeStyle
        ? { timeZone: TZ, hour12: false, ...options }
        : {
            timeZone: TZ,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            ...options,
          },
    ).format(date),
};

const DAY_MS = 86_400_000;

/** Every Bangkok midnight (17:00Z) from 2024-12-25 to 2027-01-05, ±1ms. */
const midnightBoundaries = (): Date[] => {
  const dates: Date[] = [];
  const start = Date.UTC(2024, 11, 24, 17, 0, 0, 0);
  const end = Date.UTC(2027, 0, 5, 17, 0, 0, 0);
  for (let t = start; t <= end; t += DAY_MS) {
    for (const offset of [-1, 0, 1]) dates.push(new Date(t + offset));
  }
  return dates;
};

/** Deterministic spread over 1970–2100 plus the local-midnight UTC instant of each sample. */
const spreadSamples = (count: number): Date[] => {
  let seed = 20260923;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const min = Date.UTC(1970, 0, 1);
  const max = Date.UTC(2100, 11, 31);
  const dates: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = Math.floor(min + next() * (max - min));
    dates.push(new Date(t), new Date(Math.floor(t / DAY_MS) * DAY_MS));
  }
  return dates;
};

const SPECIAL = [
  "2024-02-28T16:59:59.999Z",
  "2024-02-28T17:00:00.000Z", // 2024-02-29 00:00 Bangkok (leap day)
  "2024-02-29T17:00:00.000Z",
  "2025-12-31T16:59:59.999Z",
  "2025-12-31T17:00:00.000Z", // New Year Bangkok
  "2026-06-25T02:30:00.000Z",
  "1970-01-01T00:00:00.000Z",
].map((iso) => new Date(iso));

const ALL_DATES = [...midnightBoundaries(), ...spreadSamples(600), ...SPECIAL];

const DISPLAY_OPTION_SETS: (Intl.DateTimeFormatOptions | undefined)[] = [
  undefined,
  {},
  { dateStyle: "medium" },
  { dateStyle: "long", timeStyle: "short" },
  { timeStyle: "medium" },
  { day: "numeric", month: "short", year: "numeric" },
  { month: "long", year: "numeric" },
  { weekday: "long" },
  { hour: "2-digit", minute: "2-digit" },
  { hour12: true },
  { hour12: undefined },
  { second: "2-digit" },
  { timeZone: "UTC" },
];

test("date-key helpers match the uncached reference on every Bangkok midnight boundary and a wide spread", () => {
  for (const date of ALL_DATES) {
    const label = date.toISOString();
    // Build each reference part once per date (fresh formatter per part, as before).
    const year = refPart(date, "year");
    const month = refPart(date, "month").padStart(2, "0");
    const day = refPart(date, "day").padStart(2, "0");
    const hour = refPart(date, "hour").padStart(2, "0");
    const minute = refPart(date, "minute").padStart(2, "0");
    const dateKey = `${year}-${month}-${day}`;

    assert.equal(getThailandDateKey(date), dateKey, label);
    assert.equal(getThailandDateKey(label), dateKey, `string ${label}`);
    assert.equal(getThailandMonthStartDateKey(date), `${year}-${month}-01`, label);
    assert.equal(getThailandMonthKey(date), `${year}-${month}`, label);
    assert.equal(getThailandWeekdayIndex(date), ref.weekday(date), label);
    assert.equal(formatDateTimeLocalForInput(date), `${dateKey}T${hour}:${minute}`, label);
  }
});

test("Thai display formatters match the reference for every option set, interleaved", () => {
  const sample = ALL_DATES.filter((_, index) => index % 7 === 0);
  for (const date of sample) {
    // Interleave option sets per date so a cache mix-up would surface.
    for (const options of DISPLAY_OPTION_SETS) {
      const label = `${date.toISOString()} ${JSON.stringify(options)}`;
      assert.equal(formatDateThai(date, options), ref.dateThai(date, options), label);
      assert.equal(formatDateTimeThai(date, options), ref.dateTimeThai(date, options), label);
    }
  }
});

test("midnight Bangkok boundary flips the date key exactly at 17:00:00.000Z", () => {
  assert.equal(getThailandDateKey(new Date("2026-09-22T16:59:59.999Z")), "2026-09-22");
  assert.equal(getThailandDateKey(new Date("2026-09-22T17:00:00.000Z")), "2026-09-23");
  assert.equal(formatDateTimeLocalForInput(new Date("2026-09-22T17:00:00.000Z")), "2026-09-23T00:00");
});

test("invalid input still throws like before", () => {
  assert.throws(() => formatDateThai("not a date"), RangeError);
  assert.throws(() => formatDateThai(new Date(), { timeZone: "Not/AZone" }), RangeError);
  assert.throws(() => formatDateThai(new Date(), { timeZone: "Not/AZone" }), RangeError);
});
