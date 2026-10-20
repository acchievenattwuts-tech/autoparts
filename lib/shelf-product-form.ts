import {
  describeShelfLocations,
  formatShelfLocationCode,
  MAX_SHELF_RACK_LEVELS,
  sortShelfLocations,
  type ShelfLocationChange,
  type ShelfLocationTarget,
  type ShelfRuleError,
} from "@/lib/shelf-location-rules";

/**
 * The product form's "ที่เก็บประจำ" (home shelf location) field, kept pure and
 * client-safe: the form component, the product Server Actions and the tests share it.
 * Overflow locations (ที่เก็บเพิ่ม) are not edited here; they are managed from the shelf
 * map and the location badges.
 */

/** Hidden input carrying the chosen home as `rackId:level`, or "" for none. */
export const SHELF_PRIMARY_FIELD = "shelfPrimary";
/** Hidden input carrying the home the form was rendered with, to detect an untouched field. */
export const SHELF_PRIMARY_ORIGINAL_FIELD = "shelfPrimaryOriginal";
/** Checkbox: keep the old home as an overflow location when the home moves. */
export const SHELF_KEEP_OLD_AS_SECONDARY_FIELD = "shelfKeepOldAsSecondary";

const SHELF_PRIMARY_VALUE_PATTERN = /^([a-z0-9]{1,50}):(\d{1,2})$/;

export type ShelfRackOption = { id: string; code: string; name: string | null; levels: number };

/** A product's location as the form shows it (sorted: home first, then newest overflow). */
export type ShelfFormLocation = {
  id: string;
  rackId: string;
  level: number;
  code: string;
  isPrimary: boolean;
  note: string | null;
};

export type ShelfPrimaryOption = { id: string; label: string; sublabel?: string };

export const formatShelfPrimaryValue = (target: ShelfLocationTarget): string => `${target.rackId}:${target.level}`;

/** `rackId:level` -> target; "" or anything malformed -> null. */
export const parseShelfPrimaryValue = (value: string | null | undefined): ShelfLocationTarget | null => {
  if (!value) return null;
  const match = SHELF_PRIMARY_VALUE_PATTERN.exec(value);
  if (!match) return null;
  const level = Number.parseInt(match[2], 10);
  if (level < 1 || level > MAX_SHELF_RACK_LEVELS) return null;
  return { rackId: match[1], level };
};

/** Server-side check for the submitted field: empty, or a well-formed `rackId:level`. */
export const isValidShelfPrimaryValue = (value: string): boolean =>
  value === "" || parseShelfPrimaryValue(value) !== null;

const sameTarget = (a: ShelfLocationTarget | null, b: ShelfLocationTarget | null): boolean =>
  a === null || b === null ? a === b : a.rackId === b.rackId && a.level === b.level;

/** False when the person left the field as the form showed it: nothing to do, no query needed. */
export const isShelfPrimaryFieldChanged = (
  submitted: ShelfLocationTarget | null,
  original: ShelfLocationTarget | null,
): boolean => !sameTarget(submitted, original);

export type ProductFormShelfInput = {
  /** The product's home location in the database right now (null when it has none). */
  current: { id: string; rackId: string; level: number } | null;
  submitted: ShelfLocationTarget | null;
  original: ShelfLocationTarget | null;
  keepOldAsSecondary: boolean;
};

/**
 * Turns the field into shelf-rule changes. Compared with the form's original value first,
 * so a save that did not touch the field never overwrites a move made meanwhile from the
 * shelf map; then with the current home, so the change applies to what is stored now.
 */
export const planProductFormShelfChanges = (input: ProductFormShelfInput): ShelfLocationChange[] => {
  if (!isShelfPrimaryFieldChanged(input.submitted, input.original)) return [];
  const { current, submitted } = input;
  if (submitted) {
    if (!current) return [{ kind: "place", target: submitted }];
    if (sameTarget(current, submitted)) return [];
    return [{ kind: "movePrimary", target: submitted, keepOldAsSecondary: input.keepOldAsSecondary }];
  }
  return current ? [{ kind: "remove", locationId: current.id }] : [];
};

/** Thrown inside a product save transaction so a rejected location rolls the whole save back. */
export class ShelfFormRuleError extends Error {
  readonly ruleError: ShelfRuleError;

  constructor(ruleError: ShelfRuleError) {
    super(`SHELF_RULE_${ruleError}`);
    this.name = "ShelfFormRuleError";
    this.ruleError = ruleError;
  }
}

/** Every level of every given rack ("A-2", sublabel "ชั้นซ้าย · ชั้น 2"), plus the "ยังไม่ระบุ" option. */
export const buildShelfPrimaryOptions = (
  racks: readonly ShelfRackOption[],
  locations: readonly ShelfFormLocation[] = [],
): ShelfPrimaryOption[] => {
  const locationByValue = new Map(locations.map((location) => [formatShelfPrimaryValue(location), location]));
  const options: ShelfPrimaryOption[] = [{ id: "", label: "ยังไม่ระบุ" }];
  const listed = new Set<string>();
  for (const rack of racks) {
    for (let level = 1; level <= rack.levels; level += 1) {
      const id = formatShelfPrimaryValue({ rackId: rack.id, level });
      const existing = locationByValue.get(id);
      const parts = [rack.name, `ชั้น ${level}`, existing ? (existing.isPrimary ? "ที่เก็บประจำตอนนี้" : "ที่เก็บเพิ่มตอนนี้") : null];
      options.push({ id, label: formatShelfLocationCode(rack.code, level), sublabel: parts.filter(Boolean).join(" · ") });
      listed.add(id);
    }
  }
  // A home on a rack that was switched off (or a level that was removed) stays selectable as is.
  const home = locations.find((location) => location.isPrimary);
  if (home && !listed.has(formatShelfPrimaryValue(home))) {
    options.push({ id: formatShelfPrimaryValue(home), label: home.code, sublabel: "ชั้นวางนี้ปิดใช้งานหรือไม่มีชั้นนี้แล้ว" });
  }
  return options;
};

type ShelfLocationRowWithRack = {
  id: string;
  rackId: string;
  level: number;
  isPrimary: boolean;
  note: string | null;
  createdAt: Date;
  rack: { code: string };
};

/** Database rows (with their rack code) -> the form's sorted location list. */
export const toShelfFormLocations = (rows: readonly ShelfLocationRowWithRack[]): ShelfFormLocation[] =>
  sortShelfLocations(rows).map((row) => ({
    id: row.id,
    rackId: row.rackId,
    level: row.level,
    code: formatShelfLocationCode(row.rack.code, row.level),
    isPrimary: row.isPrimary,
    note: row.note,
  }));

/**
 * describeShelfLocations() for rows that carry their rack code instead of a rack lookup:
 * "A-2 (ประจำ)", "Z-1 (เพิ่ม)". Rack codes are unique, so they key the lookup.
 */
export const describeShelfLocationRows = (
  rows: readonly Pick<ShelfLocationRowWithRack, "level" | "isPrimary" | "createdAt" | "rack">[],
): string[] =>
  describeShelfLocations(
    rows.map((row) => ({ rackId: row.rack.code, level: row.level, isPrimary: row.isPrimary, createdAt: row.createdAt })),
    new Map(rows.map((row) => [row.rack.code, row.rack])),
  );
