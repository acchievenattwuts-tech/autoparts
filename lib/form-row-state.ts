/**
 * Client-side row bookkeeping for multi-line admin forms.
 *
 * Per-row async state (available lots, loading flags) is keyed by a stable
 * client-only `rowKey` instead of the row index, so removing a middle row never
 * hands one row's state to the row that slides into its index. The key is also
 * used as the React key, and is stripped before the items are sent to the server.
 */

let rowKeySeq = 0;

/** A new client-only row key, unique for the lifetime of the page. */
export const createRowKey = (prefix: string): string => {
  rowKeySeq += 1;
  return `${prefix}-${rowKeySeq}`;
};

/**
 * Gives every seeded item (initial data, rows loaded from another document) a fresh
 * rowKey, and re-keys per-row state that the caller built by row index.
 */
export const seedRowKeys = <T extends object, S>(
  items: T[],
  prefix: string,
  stateByIndex: Record<number, S> = {},
): { rows: (T & { rowKey: string })[]; state: Record<string, S> } => {
  const rows = items.map((item) => ({ ...item, rowKey: createRowKey(prefix) }));
  const state: Record<string, S> = {};
  rows.forEach((row, index) => {
    if (index in stateByIndex) state[row.rowKey] = stateByIndex[index];
  });
  return { rows, state };
};

/** Returns a copy of a rowKey-indexed record without `rowKey` (same object if absent). */
export const omitRowState = <T>(state: Record<string, T>, rowKey: string): Record<string, T> => {
  if (!(rowKey in state)) return state;
  const next = { ...state };
  delete next[rowKey];
  return next;
};

/** Removes the client-only `rowKey` from every item before it goes to the server action. */
export const stripRowKeys = <T extends { rowKey: string }>(items: T[]): Omit<T, "rowKey">[] =>
  items.map((item) => {
    const { rowKey, ...payload } = item;
    void rowKey;
    return payload;
  });

export interface RowRequestTracker {
  /** Starts a request for the row; any earlier request for the same row becomes stale. */
  begin: (rowKey: string) => number;
  /** True only while `token` is the latest request for a row that still exists. */
  isCurrent: (rowKey: string, token: number) => boolean;
  /** The row was removed or its product/type changed: every outstanding request for it is stale. */
  forget: (rowKey: string) => void;
  /** The whole row list was replaced: every outstanding request is stale. */
  reset: () => void;
}

/**
 * Tracks the latest async request per row so a late response cannot write into
 * a row that was removed, or whose product/type changed after the request began.
 */
export const createRowRequestTracker = (): RowRequestTracker => {
  let tokenSeq = 0;
  const latest = new Map<string, number>();
  return {
    begin: (rowKey) => {
      tokenSeq += 1;
      latest.set(rowKey, tokenSeq);
      return tokenSeq;
    },
    isCurrent: (rowKey, token) => latest.get(rowKey) === token,
    forget: (rowKey) => {
      latest.delete(rowKey);
    },
    reset: () => latest.clear(),
  };
};
