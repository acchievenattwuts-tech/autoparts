/**
 * Client-side row bookkeeping for AdjustmentForm.
 *
 * Per-row async state (available lots, loading flags) is keyed by a stable
 * `rowKey` instead of the row index, so removing a middle row never hands one
 * row's lots to the row that slides into its index. The key is client-only and
 * is stripped before the items are sent to the server.
 */

let rowKeySeq = 0;

/** A new client-only row key, unique for the lifetime of the page. */
export const createAdjustmentRowKey = (): string => {
  rowKeySeq += 1;
  return `adj-row-${rowKeySeq}`;
};

/** Returns a copy of a rowKey-indexed record without `rowKey` (same object if absent). */
export const omitRowState = <T>(state: Record<string, T>, rowKey: string): Record<string, T> => {
  if (!(rowKey in state)) return state;
  const next = { ...state };
  delete next[rowKey];
  return next;
};

/** Removes the client-only `rowKey` from every item before it goes to the server action. */
export const stripAdjustmentRowKeys = <T extends { rowKey: string }>(items: T[]): Omit<T, "rowKey">[] =>
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
