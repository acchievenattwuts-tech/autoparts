import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";

/**
 * Records a chat product search into `ProductSearchLog`, which is what makes it
 * visible to the no-result quality report at `/admin/reports/product-search-no-result`
 * and its cluster → review → `SearchSynonym` closed loop.
 *
 * Why this exists: that loop was already fully built, but `logProductSearchTelemetry`
 * was only ever called from the storefront search action and the autocomplete route.
 * Production bore it out — 2,211 `admin` rows, 330 `storefront` rows, and ZERO from
 * chat, while chat is the shop's busiest channel and 44.9% of its product turns
 * could not resolve a car model. Every one of those misses ended as a hand-off that
 * nobody could review, and the same misspelling failed again the next week.
 *
 * ── What "resultCount" means here ──────────────────────────────────────────────
 * It is the number of products the customer ACTUALLY SAW, not what the search
 * engine returned. The chat pipeline suppresses rows after the fact — the
 * vehicle-unresolved guard and the weak-match relevance gate both discard a
 * non-empty result set rather than show parts that may not fit. Logging the
 * engine's raw total would hide exactly the cases worth reviewing: the search
 * "worked" but the customer was told nothing.
 *
 * Best-effort: never throws, never blocks the reply.
 */
export async function logChatProductSearchTelemetry(input: {
  source: "line" | "messenger";
  /** The customer's own words — what a reviewer needs to see, not a rewrite. */
  query: string | null | undefined;
  /** Products actually shown to the customer AFTER every guard. */
  shownCount: number;
  filters?: {
    categoryName?: string | null;
    carBrandName?: string | null;
    carModelName?: string | null;
    fitmentYear?: number | null;
  } | null;
}): Promise<void> {
  const query = input.query?.trim();
  if (!query) return;

  try {
    await logProductSearchTelemetry({
      input: {
        query,
        isActive: true,
        isStorefrontVisible: true,
        categoryName: input.filters?.categoryName ?? null,
        carBrandName: input.filters?.carBrandName ?? null,
        carModelName: input.filters?.carModelName ?? null,
        fitmentYear: input.filters?.fitmentYear ?? null,
      },
      resultCount: input.shownCount,
      source: input.source,
      path: `chat/${input.source}`,
      // The chat pipeline runs inside a queue worker / coalescing owner loop where
      // a request scope is not guaranteed; `after()` would throw there and the row
      // would be dropped silently. One indexed upsert is cheap enough to await.
      flush: "await",
    });
  } catch {
    // Telemetry must never break a customer reply.
  }
}
