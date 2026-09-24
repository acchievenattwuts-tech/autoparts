/**
 * Client-side row bookkeeping for SaleForm.
 *
 * Every line row carries a stable client-only `rowKey` (React key + key of the
 * per-row lot state), so removing or replacing a row never hands one row's lots
 * or a late lot response to the row that slides into its index. The key is
 * stripped before the items go to the server or into the local draft.
 */

import { createRowKey, seedRowKeys, stripRowKeys } from "@/lib/form-row-state";

const SALE_ROW_KEY_PREFIX = "sale-row";

/** A new client-only row key, unique for the lifetime of the page. */
export const createSaleRowKey = (): string => createRowKey(SALE_ROW_KEY_PREFIX);

/**
 * Gives seeded rows (edit-mode initial lines, lines loaded from a quotation) fresh
 * rowKeys and re-keys lot options the caller built by row index.
 */
export const seedSaleRows = <T extends object, S>(
  items: T[],
  stateByIndex: Record<number, S> = {},
): { rows: (T & { rowKey: string })[]; state: Record<string, S> } =>
  seedRowKeys(items, SALE_ROW_KEY_PREFIX, stateByIndex);

/** The server payload and the local draft never contain the client-only rowKey. */
export const stripSaleRowKeys = stripRowKeys;

/**
 * A restored draft replaces the whole row list. A restored row keeps the rowKey —
 * and therefore the lot options — of the row it lands on only when both hold the
 * same product; every other row gets a fresh key. `droppedKeys` are the previous
 * rows whose lot state and in-flight lot requests are now stale.
 */
export const rekeyRestoredSaleRows = <T extends { productId: string }>(
  current: ReadonlyArray<{ rowKey: string; productId: string }>,
  restored: T[],
): { rows: (T & { rowKey: string })[]; droppedKeys: string[] } => {
  const rows = restored.map((item, index) => {
    const previous = current[index];
    const keepKey = previous !== undefined && item.productId !== "" && previous.productId === item.productId;
    return { ...item, rowKey: keepKey ? previous.rowKey : createSaleRowKey() };
  });
  const keptKeys = new Set(rows.map((row) => row.rowKey));
  return { rows, droppedKeys: current.map((row) => row.rowKey).filter((rowKey) => !keptKeys.has(rowKey)) };
};
