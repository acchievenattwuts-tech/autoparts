import { unstable_cache } from "next/cache";
import { LineIntent } from "@/lib/generated/prisma";
import { extractLineSearchIntent } from "@/lib/line-ai-service";
import { extractLineRequiredSearchTokens, guardLineSearchIntent } from "@/lib/line-search-guards";
import { resolveLineFitmentFilters, type LineFitmentFilters } from "@/lib/line-fitment-resolve";
import { loadCarBrandVariantLookup } from "@/lib/car-brand-alias-loader";
import { normalizeInboundLineQuery } from "@/lib/line-text-normalize";
import { normalizeSearchText } from "@/lib/search-normalization";
import { resolveKnownQueryIntent } from "@/lib/known-query-intent";
import { PRODUCT_SEARCH_TAG } from "@/lib/product-search-cache";

/**
 * Shared "search precision" pipeline used by BOTH the storefront results page and
 * the LINE OA bot, so a typed query is interpreted the same way in both channels:
 *
 *   1. LLM classify (extractLineSearchIntent) → part type / car brand / model / year
 *   2. guardLineSearchIntent → keep ONLY the brand/model/year the customer actually
 *      typed (drops hallucinated/stale fitment), plus required code anchors
 *   3. resolveLineFitmentFilters → map grounded hints to EXACT master-data names
 *      (a hint becomes a hard filter only when it resolves to a real active row)
 *
 * The result is a set of hard filters + required tokens that make the submit
 * search land on the right category / brand / year and NOT show broad, unrelated
 * items — mirroring the LINE bot's behaviour.
 *
 * Performance: the LLM classification is the only slow step, so the whole resolve
 * is cached per normalized query (catalog + query space are small, queries repeat
 * heavily → most submits hit the cache and never call Gemini). Any failure or
 * missing Gemini key degrades to literal query + required-token anchoring — i.e.
 * never worse than the previous storefront behaviour.
 */

export type ResolvedStorefrontSearchIntent = {
  /** The query string to feed the V2 engine (literal when the guard distrusts the AI rewrite). */
  query: string;
  /** Hard recall anchors (code/model fragments) — every result must contain them. */
  requiredTokens: string[];
  categoryName: string | null;
  carBrandName: string | null;
  carModelName: string | null;
  fitmentYear: number | null;
};

const SEARCH_INTENT_CACHE_TTL_SECONDS = 60 * 60 * 24; // 1 day

const literalFallback = (query: string): ResolvedStorefrontSearchIntent => ({
  query,
  requiredTokens: extractLineRequiredSearchTokens(query),
  categoryName: null,
  carBrandName: null,
  carModelName: null,
  fitmentYear: null,
});

/** A query that is a single code-like token (e.g. "W3-7044") needs no LLM — the
 *  required-token anchor already pins it precisely. Skipping the classify keeps
 *  part-number lookups instant. */
const isPureCodeQuery = (query: string): boolean => {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  return tokens.length === 1 && extractLineRequiredSearchTokens(query).length > 0;
};

async function resolveUncached(rawQuery: string): Promise<ResolvedStorefrontSearchIntent> {
  const processText = normalizeInboundLineQuery(rawQuery) || rawQuery;

  if (isPureCodeQuery(rawQuery)) {
    return literalFallback(rawQuery);
  }

  // Rule-first (Hybrid A): when the whole query decomposes into known dictionary
  // terms / year / code, derive the intent WITHOUT the LLM. The storefront has no
  // conversational context, so any fully-known query is safe to short-circuit.
  const known = await resolveKnownQueryIntent(rawQuery).catch(() => null);
  if (known) {
    return {
      query: known.query,
      requiredTokens: known.requiredTokens,
      categoryName: known.categoryName,
      carBrandName: known.carBrandName,
      carModelName: known.carModelName,
      fitmentYear: known.fitmentYear,
    };
  }

  const intent = await extractLineSearchIntent({
    intent: LineIntent.PRODUCT_INQUIRY_TEXT,
    latestText: processText,
    history: [],
  }).catch(() => null);

  // No classification available (no key / failure) → literal + required tokens.
  if (!intent || !intent.isProductQuery) {
    return literalFallback(rawQuery);
  }

  const brandLookup = await loadCarBrandVariantLookup().catch(() => null);
  const guarded = guardLineSearchIntent({
    intent,
    latestText: processText,
    history: [],
    brandLookup,
  });

  const guardedIntent = guarded.intent;
  // Required tokens always come from the customer-typed text (guard returns [] when
  // the intent isn't a product query, so recompute defensively).
  const requiredTokens =
    guarded.requiredTokens.length > 0
      ? guarded.requiredTokens
      : extractLineRequiredSearchTokens(rawQuery);

  // When the guard distrusts the AI rewrite, search the literal customer text.
  const query = guarded.forceLiteralQuery
    ? rawQuery.trim() || processText
    : guardedIntent?.query?.trim() || rawQuery.trim() || processText;

  const fitment = await resolveLineFitmentFilters({
    partType: guardedIntent?.partType ?? null,
    carBrand: guardedIntent?.carBrand ?? null,
    carModel: guardedIntent?.carModel ?? null,
    queryText: query,
    rawText: rawQuery,
  }).catch((): LineFitmentFilters => ({}));

  return {
    query,
    requiredTokens,
    categoryName: fitment.categoryName ?? null,
    carBrandName: fitment.carBrandName ?? null,
    carModelName: fitment.carModelName ?? null,
    fitmentYear: guardedIntent?.year ?? null,
  };
}

/**
 * Cached entry point. Caches the resolved intent per normalized query for a day so
 * repeated searches skip the Gemini round-trip. Invalidated together with the
 * product-search cache when the catalog changes.
 */
export async function resolveStorefrontSearchIntent(
  rawQuery: string | null | undefined,
): Promise<ResolvedStorefrontSearchIntent | null> {
  const trimmed = rawQuery?.trim();
  if (!trimmed) return null;
  const normalized = normalizeSearchText(trimmed);
  if (!normalized) return null;

  return unstable_cache(
    () => resolveUncached(trimmed),
    [`storefront-search-intent:${normalized}`],
    {
      tags: [PRODUCT_SEARCH_TAG],
      revalidate: SEARCH_INTENT_CACHE_TTL_SECONDS,
    },
  )();
}
