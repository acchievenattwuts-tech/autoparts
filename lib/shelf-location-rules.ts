/**
 * Shelf location rules (ผังชั้นวาง), pure and database-free so every rule is unit-testable.
 *
 * A location is a rack plus a level ("A-2" = rack A, level 2 counted from the bottom).
 * Each product has at most one primary ("home", ที่เก็บประจำ) location and up to
 * MAX_SECONDARY_SHELF_LOCATIONS secondary (overflow, ที่เก็บเพิ่ม) locations. No quantity
 * is kept per location; Product.stock stays the only stock figure.
 *
 * Callers describe what a person did as a ShelfLocationChange. applyShelfLocationChange()
 * replays it on an in-memory copy of the product's locations, and diffShelfLocations()
 * turns the result into the rows to delete, create and update.
 */

export const MAX_SECONDARY_SHELF_LOCATIONS = 3;
export const MAX_SHELF_RACK_LEVELS = 20;
export const SHELF_RACK_CODE_MAX_LENGTH = 4;
export const SHELF_RACK_CODE_PATTERN = /^[A-Z0-9]{1,4}$/;
export const SHELF_LOCATION_NOTE_MAX_LENGTH = 100;

export type ShelfRackRule = {
  id: string;
  code: string;
  levels: number;
  isActive: boolean;
};

export type ShelfLocationTarget = { rackId: string; level: number };

/** A product's location as stored, or as planned (id null = not created yet). */
export type ShelfLocationDraft = {
  id: string | null;
  rackId: string;
  level: number;
  isPrimary: boolean;
  note: string | null;
  createdAt: Date;
  /** True when a person set, moved or confirmed it in this change (refreshes verifiedAt). */
  touched: boolean;
};

export type ShelfLocationChange =
  /** Put the product here: first location becomes primary, an existing one is confirmed, otherwise a secondary is added. */
  | { kind: "place"; target: ShelfLocationTarget }
  /** Confirm an existing location (เก็บที่เดิม / ✓). */
  | { kind: "confirm"; locationId: string }
  /** Add an overflow location (วางที่อื่นเพิ่ม). */
  | { kind: "addSecondary"; target: ShelfLocationTarget }
  /** Move the home location (ย้ายที่เก็บประจำ); the old home is kept as a secondary or removed. */
  | { kind: "movePrimary"; target: ShelfLocationTarget; keepOldAsSecondary: boolean }
  /** Make a secondary the home; the old home becomes a secondary (ตั้งเป็นที่ประจำ). */
  | { kind: "promote"; locationId: string }
  /** Remove a location (ที่นี่หมดแล้ว / ไม่พบ). Removing the home promotes the newest secondary. */
  | { kind: "remove"; locationId: string }
  /** Move one location elsewhere, keeping its type (import: a new rack/level on an existing row). */
  | { kind: "relocate"; locationId: string; target: ShelfLocationTarget }
  /** Set or clear the free-text note of a location. */
  | { kind: "setNote"; locationId: string; note: string | null };

export type ShelfRuleError =
  | "RACK_NOT_FOUND"
  | "RACK_INACTIVE"
  | "LEVEL_OUT_OF_RANGE"
  | "SECONDARY_LIMIT"
  | "LOCATION_NOT_FOUND"
  | "NOTE_TOO_LONG";

export const SHELF_RULE_ERROR_MESSAGES: Record<ShelfRuleError, string> = {
  RACK_NOT_FOUND: "ไม่พบชั้นวางนี้",
  RACK_INACTIVE: "ชั้นวางนี้ถูกปิดใช้งานแล้ว",
  LEVEL_OUT_OF_RANGE: "ชั้นวางนี้ไม่มีชั้นที่ระบุ",
  SECONDARY_LIMIT: `มีที่เก็บเพิ่มครบ ${MAX_SECONDARY_SHELF_LOCATIONS} แห่งแล้ว ให้เอาที่ที่ว่างออกก่อน`,
  LOCATION_NOT_FOUND: "ไม่พบตำแหน่งนี้ อาจถูกเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่",
  NOTE_TOO_LONG: `หมายเหตุตำแหน่งยาวได้ไม่เกิน ${SHELF_LOCATION_NOTE_MAX_LENGTH} ตัวอักษร`,
};

export type ShelfRuleResult =
  | { ok: true; locations: ShelfLocationDraft[] }
  | { ok: false; error: ShelfRuleError };

export const normalizeShelfRackCode = (value: string): string => value.trim().toUpperCase();

export const formatShelfLocationCode = (rackCode: string, level: number): string => `${rackCode}-${level}`;

/** "A-2" / "a - 2" -> { rackCode: "A", level: 2 }; anything else -> null. */
export const parseShelfLocationCode = (value: string): { rackCode: string; level: number } | null => {
  const match = /^\s*([A-Za-z0-9]{1,4})\s*-\s*(\d{1,2})\s*$/.exec(value);
  if (!match) return null;
  const level = Number.parseInt(match[2], 10);
  if (level < 1) return null;
  return { rackCode: match[1].toUpperCase(), level };
};

/** Primary first, then secondaries newest first. */
export const sortShelfLocations = <T extends { isPrimary: boolean; createdAt: Date }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

export const validateShelfTarget = (
  target: ShelfLocationTarget,
  racksById: ReadonlyMap<string, ShelfRackRule>,
): ShelfRuleError | null => {
  const rack = racksById.get(target.rackId);
  if (!rack) return "RACK_NOT_FOUND";
  if (!rack.isActive) return "RACK_INACTIVE";
  if (!Number.isInteger(target.level) || target.level < 1 || target.level > rack.levels) return "LEVEL_OUT_OF_RANGE";
  return null;
};

const sameTarget = (location: ShelfLocationDraft, target: ShelfLocationTarget): boolean =>
  location.rackId === target.rackId && location.level === target.level;

const secondaryCount = (locations: readonly ShelfLocationDraft[]): number =>
  locations.filter((location) => !location.isPrimary).length;

const withinSecondaryLimit = (locations: ShelfLocationDraft[]): ShelfRuleResult =>
  secondaryCount(locations) > MAX_SECONDARY_SHELF_LOCATIONS
    ? { ok: false, error: "SECONDARY_LIMIT" }
    : { ok: true, locations };

/** Newest secondary becomes the home when the home goes away. */
const promoteNewestSecondary = (locations: ShelfLocationDraft[]): ShelfLocationDraft[] => {
  if (locations.length === 0 || locations.some((location) => location.isPrimary)) return locations;
  const newest = sortShelfLocations(locations)[0];
  return locations.map((location) => (location === newest ? { ...location, isPrimary: true } : location));
};

const newLocation = (target: ShelfLocationTarget, isPrimary: boolean, now: Date): ShelfLocationDraft => ({
  id: null,
  rackId: target.rackId,
  level: target.level,
  isPrimary,
  note: null,
  createdAt: now,
  touched: true,
});

const touch = (locations: ShelfLocationDraft[], match: ShelfLocationDraft): ShelfLocationDraft[] =>
  locations.map((location) => (location === match ? { ...location, touched: true } : location));

const findById = (locations: readonly ShelfLocationDraft[], locationId: string): ShelfLocationDraft | undefined =>
  locations.find((location) => location.id === locationId);

const applyPlace = (locations: ShelfLocationDraft[], target: ShelfLocationTarget, now: Date): ShelfRuleResult => {
  const existing = locations.find((location) => sameTarget(location, target));
  if (existing) return { ok: true, locations: touch(locations, existing) };
  const hasPrimary = locations.some((location) => location.isPrimary);
  return withinSecondaryLimit([...locations, newLocation(target, !hasPrimary, now)]);
};

const applyAddSecondary = (locations: ShelfLocationDraft[], target: ShelfLocationTarget, now: Date): ShelfRuleResult => {
  const existing = locations.find((location) => sameTarget(location, target));
  if (existing) return { ok: true, locations: touch(locations, existing) };
  if (!locations.some((location) => location.isPrimary)) {
    return { ok: true, locations: [...locations, newLocation(target, true, now)] };
  }
  return withinSecondaryLimit([...locations, newLocation(target, false, now)]);
};

const applyMovePrimary = (
  locations: ShelfLocationDraft[],
  target: ShelfLocationTarget,
  keepOldAsSecondary: boolean,
  now: Date,
): ShelfRuleResult => {
  const oldPrimary = locations.find((location) => location.isPrimary);
  if (oldPrimary && sameTarget(oldPrimary, target)) return { ok: true, locations: touch(locations, oldPrimary) };

  let next = locations.flatMap((location) => {
    if (location !== oldPrimary) return [location];
    return keepOldAsSecondary ? [{ ...location, isPrimary: false }] : [];
  });
  const existingAtTarget = next.find((location) => sameTarget(location, target));
  next = existingAtTarget
    ? next.map((location) => (location === existingAtTarget ? { ...location, isPrimary: true, touched: true } : location))
    : [...next, newLocation(target, true, now)];
  return withinSecondaryLimit(next);
};

const applyPromote = (locations: ShelfLocationDraft[], locationId: string): ShelfRuleResult => {
  const target = findById(locations, locationId);
  if (!target) return { ok: false, error: "LOCATION_NOT_FOUND" };
  if (target.isPrimary) return { ok: true, locations: touch(locations, target) };
  return {
    ok: true,
    locations: locations.map((location) => {
      if (location === target) return { ...location, isPrimary: true, touched: true };
      if (location.isPrimary) return { ...location, isPrimary: false };
      return location;
    }),
  };
};

const applyRemove = (locations: ShelfLocationDraft[], locationId: string): ShelfRuleResult => {
  const target = findById(locations, locationId);
  if (!target) return { ok: false, error: "LOCATION_NOT_FOUND" };
  return { ok: true, locations: promoteNewestSecondary(locations.filter((location) => location !== target)) };
};

const applyRelocate = (
  locations: ShelfLocationDraft[],
  locationId: string,
  target: ShelfLocationTarget,
): ShelfRuleResult => {
  const moving = findById(locations, locationId);
  if (!moving) return { ok: false, error: "LOCATION_NOT_FOUND" };
  if (sameTarget(moving, target)) return { ok: true, locations: touch(locations, moving) };
  const occupant = locations.find((location) => location !== moving && sameTarget(location, target));
  if (occupant) {
    // The product is already there: merge into that row, carrying the home flag over.
    return {
      ok: true,
      locations: locations
        .filter((location) => location !== moving)
        .map((location) =>
          location === occupant ? { ...location, isPrimary: location.isPrimary || moving.isPrimary, touched: true } : location,
        ),
    };
  }
  return {
    ok: true,
    locations: locations.map((location) =>
      location === moving ? { ...location, rackId: target.rackId, level: target.level, touched: true } : location,
    ),
  };
};

const applySetNote = (locations: ShelfLocationDraft[], locationId: string, note: string | null): ShelfRuleResult => {
  const target = findById(locations, locationId);
  if (!target) return { ok: false, error: "LOCATION_NOT_FOUND" };
  const trimmed = note?.trim() ?? "";
  if (trimmed.length > SHELF_LOCATION_NOTE_MAX_LENGTH) return { ok: false, error: "NOTE_TOO_LONG" };
  return {
    ok: true,
    locations: locations.map((location) => (location === target ? { ...location, note: trimmed || null } : location)),
  };
};

const changeTarget = (change: ShelfLocationChange): ShelfLocationTarget | null =>
  "target" in change ? change.target : null;

/** Replays one change on a product's locations. Never mutates its input. */
export const applyShelfLocationChange = (
  locations: readonly ShelfLocationDraft[],
  change: ShelfLocationChange,
  racksById: ReadonlyMap<string, ShelfRackRule>,
  now: Date,
): ShelfRuleResult => {
  const target = changeTarget(change);
  if (target) {
    const targetError = validateShelfTarget(target, racksById);
    if (targetError) return { ok: false, error: targetError };
  }
  const current = [...locations];
  switch (change.kind) {
    case "place":
      return applyPlace(current, change.target, now);
    case "confirm": {
      const location = findById(current, change.locationId);
      return location ? { ok: true, locations: touch(current, location) } : { ok: false, error: "LOCATION_NOT_FOUND" };
    }
    case "addSecondary":
      return applyAddSecondary(current, change.target, now);
    case "movePrimary":
      return applyMovePrimary(current, change.target, change.keepOldAsSecondary, now);
    case "promote":
      return applyPromote(current, change.locationId);
    case "remove":
      return applyRemove(current, change.locationId);
    case "relocate":
      return applyRelocate(current, change.locationId, change.target);
    case "setNote":
      return applySetNote(current, change.locationId, change.note);
  }
};

export type ShelfLocationRowUpdate = {
  id: string;
  rackId?: string;
  level?: number;
  isPrimary?: boolean;
  note?: string | null;
  verify: boolean;
};

export type ShelfLocationCreate = {
  rackId: string;
  level: number;
  isPrimary: boolean;
  note: string | null;
};

export type ShelfLocationDiff = {
  deleteIds: string[];
  creates: ShelfLocationCreate[];
  updates: ShelfLocationRowUpdate[];
};

export const isEmptyShelfLocationDiff = (diff: ShelfLocationDiff): boolean =>
  diff.deleteIds.length === 0 && diff.creates.length === 0 && diff.updates.length === 0;

/** True when the diff changes nothing but verifiedAt (a confirmation), or nothing at all. */
export const isVerifyOnlyShelfDiff = (diff: ShelfLocationDiff): boolean =>
  diff.deleteIds.length === 0 &&
  diff.creates.length === 0 &&
  diff.updates.every(
    (update) =>
      update.rackId === undefined && update.level === undefined && update.isPrimary === undefined && update.note === undefined,
  );

/** Rows to delete, create and update to turn `before` into `after`. */
export const diffShelfLocations = (
  before: readonly ShelfLocationDraft[],
  after: readonly ShelfLocationDraft[],
): ShelfLocationDiff => {
  const afterIds = new Set(after.flatMap((location) => (location.id ? [location.id] : [])));
  const beforeById = new Map(before.flatMap((location) => (location.id ? [[location.id, location] as const] : [])));

  const deleteIds = before.flatMap((location) => (location.id && !afterIds.has(location.id) ? [location.id] : []));
  const creates = after.flatMap((location) =>
    location.id === null
      ? [{ rackId: location.rackId, level: location.level, isPrimary: location.isPrimary, note: location.note }]
      : [],
  );
  const updates = after.flatMap((location): ShelfLocationRowUpdate[] => {
    if (location.id === null) return [];
    const previous = beforeById.get(location.id);
    if (!previous) return [];
    const update: ShelfLocationRowUpdate = { id: location.id, verify: location.touched };
    // A relocation always carries the full target, so the executor can park and restore rows.
    if (previous.rackId !== location.rackId || previous.level !== location.level) {
      update.rackId = location.rackId;
      update.level = location.level;
    }
    if (previous.isPrimary !== location.isPrimary) update.isPrimary = location.isPrimary;
    if (previous.note !== location.note) update.note = location.note;
    const fieldChanged =
      update.rackId !== undefined || update.level !== undefined || update.isPrimary !== undefined || update.note !== undefined;
    return fieldChanged || update.verify ? [update] : [];
  });
  return { deleteIds, creates, updates };
};

/** "A-2 (ประจำ)", "Z-1 (เพิ่ม)" — the audit and Excel description of a product's locations. */
export const describeShelfLocations = (
  locations: readonly Pick<ShelfLocationDraft, "rackId" | "level" | "isPrimary" | "createdAt">[],
  racksById: ReadonlyMap<string, Pick<ShelfRackRule, "code">>,
): string[] =>
  sortShelfLocations(locations).map((location) => {
    const code = formatShelfLocationCode(racksById.get(location.rackId)?.code ?? "?", location.level);
    return `${code} (${location.isPrimary ? "ประจำ" : "เพิ่ม"})`;
  });
