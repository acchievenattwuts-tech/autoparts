import type { AuditLogActor, AuditLogInput, AuditRequestContext } from "@/lib/audit-log";
import { AuditAction, type Prisma } from "@/lib/generated/prisma";
import { buildOutOfStockProductsWhere } from "@/lib/out-of-stock-products";
import {
  applyShelfLocationChange,
  describeShelfLocations,
  diffShelfLocations,
  formatShelfLocationCode,
  isEmptyShelfLocationDiff,
  isVerifyOnlyShelfDiff,
  sortShelfLocations,
  type ShelfLocationChange,
  type ShelfLocationDiff,
  type ShelfLocationDraft,
  type ShelfRackRule,
  type ShelfRuleError,
} from "@/lib/shelf-location-rules";

/**
 * Database side of the shelf map (ผังชั้นวาง). The rules themselves live in
 * lib/shelf-location-rules.ts; this module loads racks and locations, applies the
 * planned row changes in batches, and builds the display rows every page shares.
 */

type Client = Prisma.TransactionClient;

export type ShelfRackLookup = {
  list: ShelfRackRule[];
  byId: Map<string, ShelfRackRule>;
  byCode: Map<string, ShelfRackRule>;
};

/** Every rack, active or not: inactive racks still name existing locations. */
export const loadShelfRackLookup = async (client: Client): Promise<ShelfRackLookup> => {
  const list = await client.shelfRack.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, levels: true, isActive: true },
  });
  return {
    list,
    byId: new Map(list.map((rack) => [rack.id, rack])),
    byCode: new Map(list.map((rack) => [rack.code, rack])),
  };
};

const SHELF_LOCATION_DRAFT_SELECT = {
  id: true,
  productId: true,
  rackId: true,
  level: true,
  isPrimary: true,
  note: true,
  createdAt: true,
} as const satisfies Prisma.ProductShelfLocationSelect;

export const loadProductShelfDrafts = async (
  client: Client,
  productIds: readonly string[],
): Promise<Map<string, ShelfLocationDraft[]>> => {
  const result = new Map<string, ShelfLocationDraft[]>(productIds.map((id) => [id, []]));
  if (productIds.length === 0) return result;
  const rows = await client.productShelfLocation.findMany({
    where: { productId: { in: [...productIds] } },
    select: SHELF_LOCATION_DRAFT_SELECT,
  });
  for (const row of rows) {
    result.get(row.productId)?.push({
      id: row.id,
      rackId: row.rackId,
      level: row.level,
      isPrimary: row.isPrimary,
      note: row.note,
      createdAt: row.createdAt,
      touched: false,
    });
  }
  return result;
};

export type ProductShelfDiff = { productId: string; diff: ShelfLocationDiff };

/**
 * Applies many products' planned changes in a few statements. Order keeps both unique
 * indexes satisfied: deletes, then demotions, then moves, then promotions, then inserts.
 */
export const applyShelfLocationDiffs = async (
  tx: Client,
  entries: readonly ProductShelfDiff[],
  now: Date,
): Promise<void> => {
  const deleteIds = entries.flatMap((entry) => entry.diff.deleteIds);
  const updates = entries.flatMap((entry) => entry.diff.updates);
  const demoteIds = updates.flatMap((update) => (update.isPrimary === false ? [update.id] : []));
  const moves = updates.filter((update) => update.rackId !== undefined || update.level !== undefined || update.note !== undefined);
  const promoteIds = updates.flatMap((update) => (update.isPrimary === true ? [update.id] : []));
  const verifyIds = updates.flatMap((update) => (update.verify ? [update.id] : []));
  const creates = entries.flatMap((entry) =>
    entry.diff.creates.map((create) => ({ ...create, productId: entry.productId, verifiedAt: now })),
  );

  if (deleteIds.length > 0) await tx.productShelfLocation.deleteMany({ where: { id: { in: deleteIds } } });
  if (demoteIds.length > 0) {
    await tx.productShelfLocation.updateMany({ where: { id: { in: demoteIds } }, data: { isPrimary: false } });
  }
  const relocations = moves.filter((move) => move.rackId !== undefined || move.level !== undefined);
  if (relocations.length > 1) {
    // Chained moves of one product (Z-1 -> B-2 while A-2 -> Z-1) would collide on
    // (productId, rackId, level) in any single pass, so park every moving row on its own
    // negative level first; real levels start at 1, so parked rows never clash.
    for (const [index, move] of relocations.entries()) {
      await tx.productShelfLocation.update({ where: { id: move.id }, data: { level: -1 - index }, select: { id: true } });
    }
  }
  for (const move of moves) {
    // diffShelfLocations() always sends rackId and level together for a relocation.
    await tx.productShelfLocation.update({
      where: { id: move.id },
      data: {
        ...(move.rackId !== undefined ? { rackId: move.rackId } : {}),
        ...(move.level !== undefined ? { level: move.level } : {}),
        ...(move.note !== undefined ? { note: move.note } : {}),
      },
      select: { id: true },
    });
  }
  if (promoteIds.length > 0) {
    await tx.productShelfLocation.updateMany({ where: { id: { in: promoteIds } }, data: { isPrimary: true } });
  }
  if (creates.length > 0) await tx.productShelfLocation.createMany({ data: creates });
  if (verifyIds.length > 0) {
    await tx.productShelfLocation.updateMany({ where: { id: { in: verifyIds } }, data: { verifiedAt: now } });
  }
};

export type ShelfChangeOutcome =
  /** changed is false when the change only confirmed locations (verifiedAt) or did nothing. */
  | { ok: true; changed: boolean; before: string[]; after: string[] }
  | { ok: false; error: ShelfRuleError };

/** Plans and applies one person's change to one product inside the caller's transaction. */
export const changeProductShelfLocation = async (
  tx: Client,
  input: { productId: string; changes: readonly ShelfLocationChange[]; now: Date; racks?: ShelfRackLookup },
): Promise<ShelfChangeOutcome> => {
  const racks = input.racks ?? (await loadShelfRackLookup(tx));
  const before = (await loadProductShelfDrafts(tx, [input.productId])).get(input.productId) ?? [];
  let next: ShelfLocationDraft[] = before;
  for (const change of input.changes) {
    const result = applyShelfLocationChange(next, change, racks.byId, input.now);
    if (!result.ok) return result;
    next = result.locations;
  }
  const diff = diffShelfLocations(before, next);
  if (!isEmptyShelfLocationDiff(diff)) {
    await applyShelfLocationDiffs(tx, [{ productId: input.productId, diff }], input.now);
  }
  return {
    ok: true,
    changed: !isVerifyOnlyShelfDiff(diff),
    before: describeShelfLocations(before, racks.byId),
    after: describeShelfLocations(next, racks.byId),
  };
};

export type ProductShelfBatchEntry = {
  productId: string;
  /** The changes for this product, worked out from its current locations, or a rule error. */
  resolve: (locations: readonly ShelfLocationDraft[]) => ShelfLocationChange[] | ShelfRuleError;
};

export type ProductShelfBatchResult =
  | { productId: string; ok: true; changed: boolean; before: string[]; after: string[] }
  | { productId: string; ok: false; error: ShelfRuleError };

/**
 * Many products at once (put-away bulk actions): one read of racks and locations, the shared
 * rules per product, then one batched write. A product whose change breaks a rule is skipped
 * and reported; the others are saved.
 */
export const changeManyProductShelfLocations = async (
  tx: Client,
  input: { entries: readonly ProductShelfBatchEntry[]; now: Date },
): Promise<ProductShelfBatchResult[]> => {
  const racks = await loadShelfRackLookup(tx);
  const draftsByProduct = await loadProductShelfDrafts(
    tx,
    input.entries.map((entry) => entry.productId),
  );
  const results: ProductShelfBatchResult[] = [];
  const diffs: ProductShelfDiff[] = [];
  for (const entry of input.entries) {
    const before = draftsByProduct.get(entry.productId) ?? [];
    const changes = entry.resolve(before);
    if (typeof changes === "string") {
      results.push({ productId: entry.productId, ok: false, error: changes });
      continue;
    }
    let next: ShelfLocationDraft[] = before;
    let failed: ShelfRuleError | null = null;
    for (const change of changes) {
      const result = applyShelfLocationChange(next, change, racks.byId, input.now);
      if (!result.ok) {
        failed = result.error;
        break;
      }
      next = result.locations;
    }
    if (failed) {
      results.push({ productId: entry.productId, ok: false, error: failed });
      continue;
    }
    const diff = diffShelfLocations(before, next);
    if (!isEmptyShelfLocationDiff(diff)) diffs.push({ productId: entry.productId, diff });
    results.push({
      productId: entry.productId,
      ok: true,
      changed: !isVerifyOnlyShelfDiff(diff),
      before: describeShelfLocations(before, racks.byId),
      after: describeShelfLocations(next, racks.byId),
    });
  }
  if (diffs.length > 0) await applyShelfLocationDiffs(tx, diffs, input.now);
  return results;
};

/** Where a location change came from, recorded in the audit meta. */
export type ShelfAuditSource =
  | "shelf_badge"
  | "product_form"
  | "shelf_import"
  | "shelf_secondary_cleanup"
  | "put_away";

/** One audit entry per product whose locations changed or were confirmed (entityType Product). */
export const buildShelfLocationAuditInput = (input: {
  actor: AuditLogActor;
  requestContext?: AuditRequestContext;
  productId: string;
  productCode: string;
  before: string[];
  after: string[];
  changed: boolean;
  source: ShelfAuditSource;
  meta?: Record<string, unknown>;
}): AuditLogInput => ({
  ...input.actor,
  ...(input.requestContext ?? {}),
  action: AuditAction.UPDATE,
  entityType: "Product",
  entityId: input.productId,
  entityRef: input.productCode,
  before: { shelfLocations: input.before },
  after: { shelfLocations: input.after },
  meta: { kind: "shelf_location", source: input.source, confirmOnly: !input.changed, ...(input.meta ?? {}) },
});

export type ShelfLocationView = {
  id: string;
  code: string;
  rackCode: string;
  rackName: string | null;
  level: number;
  isPrimary: boolean;
  note: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
};

/** Display rows for many products, primary first then newest secondary. */
export const loadProductShelfLocationViews = async (
  client: Client,
  productIds: readonly string[],
): Promise<Map<string, ShelfLocationView[]>> => {
  const result = new Map<string, ShelfLocationView[]>(productIds.map((id) => [id, []]));
  if (productIds.length === 0) return result;
  const rows = await client.productShelfLocation.findMany({
    where: { productId: { in: [...productIds] } },
    select: {
      id: true,
      productId: true,
      level: true,
      isPrimary: true,
      note: true,
      verifiedAt: true,
      createdAt: true,
      rack: { select: { code: true, name: true } },
    },
  });
  for (const row of rows) {
    result.get(row.productId)?.push({
      id: row.id,
      code: formatShelfLocationCode(row.rack.code, row.level),
      rackCode: row.rack.code,
      rackName: row.rack.name,
      level: row.level,
      isPrimary: row.isPrimary,
      note: row.note,
      verifiedAt: row.verifiedAt,
      createdAt: row.createdAt,
    });
  }
  for (const [productId, views] of result) result.set(productId, sortShelfLocations(views));
  return result;
};

export type SecondaryCleanupRow = { productId: string; productCode: string; removed: string[] };

/**
 * Q11 (approved 2026-10-19): once a tracked product's total stock is at or below zero,
 * nothing can still be sitting in its overflow locations, so they are removed. The home
 * location is always kept for the next receipt. Returns what was removed, for the audit.
 */
export const removeSecondaryLocationsOfOutOfStockProducts = async (tx: Client): Promise<SecondaryCleanupRow[]> => {
  const rows = await tx.productShelfLocation.findMany({
    where: { isPrimary: false, product: buildOutOfStockProductsWhere() },
    select: {
      id: true,
      productId: true,
      level: true,
      product: { select: { code: true } },
      rack: { select: { code: true } },
    },
    orderBy: [{ productId: "asc" }],
  });
  if (rows.length === 0) return [];
  await tx.productShelfLocation.deleteMany({ where: { id: { in: rows.map((row) => row.id) }, isPrimary: false } });

  const byProduct = new Map<string, SecondaryCleanupRow>();
  for (const row of rows) {
    const entry = byProduct.get(row.productId) ?? { productId: row.productId, productCode: row.product.code, removed: [] };
    entry.removed.push(formatShelfLocationCode(row.rack.code, row.level));
    byProduct.set(row.productId, entry);
  }
  return [...byProduct.values()];
};
