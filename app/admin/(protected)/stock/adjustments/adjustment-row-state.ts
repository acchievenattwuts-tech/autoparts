/**
 * Client-side row bookkeeping for AdjustmentForm.
 *
 * Per-row async state (available lots, loading flags) is keyed by a stable
 * `rowKey` instead of the row index, so removing a middle row never hands one
 * row's lots to the row that slides into its index. The key is client-only and
 * is stripped before the items are sent to the server. The helpers are shared
 * with other multi-line forms through `lib/form-row-state.ts`.
 */

import { createRowKey, stripRowKeys } from "@/lib/form-row-state";

export { createRowRequestTracker, omitRowState, type RowRequestTracker } from "@/lib/form-row-state";

/** A new client-only row key, unique for the lifetime of the page. */
export const createAdjustmentRowKey = (): string => createRowKey("adj-row");

/** Removes the client-only `rowKey` from every item before it goes to the server action. */
export const stripAdjustmentRowKeys = stripRowKeys;
