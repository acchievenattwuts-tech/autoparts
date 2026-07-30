import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import {
  generateGeminiEmbedding,
  GEMINI_EMBEDDING_DIMENSIONS,
  getGeminiEmbeddingModel,
} from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";

/**
 * Semantic embedding helpers for hybrid product search (Phase 1).
 *
 * All functions degrade gracefully: when Gemini keys are absent, the feature flag
 * is off, or any call fails, query helpers return null and the caller falls back
 * to the existing lexical search — so hybrid search is purely additive.
 */

export { GEMINI_EMBEDDING_DIMENSIONS };

/** Hard cap so an unusually long product/query string can't blow the embed budget. */
const MAX_EMBED_CHARS = 2_000;

/**
 * Whether semantic search is enabled. Off by default until the `embedding` column
 * is provisioned + backfilled; flip `PRODUCT_SEARCH_SEMANTIC=on` to activate.
 */
export function isSemanticSearchEnabled(): boolean {
  return (
    process.env.PRODUCT_SEARCH_SEMANTIC?.trim().toLowerCase() === "on" && hasGeminiKeysConfigured()
  );
}

const clip = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, MAX_EMBED_CHARS);

/**
 * Composes the canonical text used to embed a product. Mirrors the lexical
 * `search_text` intent: part name + category + parts brand + car fitment, so the
 * vector captures "what this part is and what it fits".
 */
export function buildProductEmbeddingText(input: {
  productName: string;
  categoryName?: string | null;
  brandName?: string | null;
  carText?: string | null;
  fitmentText?: string | null;
  keywordText?: string | null;
}): string {
  return clip(
    [
      input.productName,
      input.categoryName,
      input.brandName,
      input.carText,
      input.fitmentText,
      input.keywordText,
    ]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join(" • "),
  );
}

export function buildProductEmbeddingSourceHash(text: string): string {
  return createHash("sha256").update(clip(text), "utf8").digest("hex");
}

export function getProductEmbeddingModelId(): string {
  return `${getGeminiEmbeddingModel()}:${GEMINI_EMBEDDING_DIMENSIONS}`;
}

/** Formats a vector as a pgvector literal: `[0.1,0.2,...]`. */
export function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Embeds a batch of texts. Returns one vector per input (same order) or null for
 * an input that came back malformed. Throws only if every key is exhausted —
 * backfill callers should catch and retry the failed slice later.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors = await generateGeminiEmbedding(texts.map(clip));
  return vectors;
}

/** Query-embedding cache lifetime. Search queries repeat heavily and an
 *  embedding is deterministic for a given input + model, so a day-long cache cuts
 *  the per-search Gemini round-trip (latency + quota) without changing results. */
const EMBED_QUERY_CACHE_TTL_SECONDS = 60 * 60 * 24; // 1 day

/**
 * Cache key for a query embedding. Pure + exported for testability. The model
 * dimension is folded into the key so swapping the embedding model can never
 * serve a stale-shape vector from cache.
 */
export function buildQueryEmbeddingCacheKey(clippedQuery: string): string {
  return `query-embedding:${getProductEmbeddingModelId()}:${clippedQuery}`;
}

/**
 * Fetches + caches the embedding for an already-clipped query string. Throws on
 * failure (no key / API error / bad shape) so a failed call is NEVER cached —
 * unstable_cache only memoises successful vectors, letting the next request retry.
 */
const fetchCachedQueryEmbedding = (clippedQuery: string): Promise<number[]> =>
  unstable_cache(
    async () => {
      const [vector] = await generateGeminiEmbedding([clippedQuery]);
      if (!vector || vector.length !== GEMINI_EMBEDDING_DIMENSIONS) {
        throw new Error(`EMBED_QUERY_INVALID:${vector?.length ?? "null"}`);
      }
      return vector;
    },
    [buildQueryEmbeddingCacheKey(clippedQuery)],
    { revalidate: EMBED_QUERY_CACHE_TTL_SECONDS, tags: ["query-embedding"] },
  )();

/**
 * Embeds a single query string for semantic search. Returns null (never throws)
 * when semantic search is disabled, the input is empty, or embedding fails — the
 * caller then runs lexical-only search.
 *
 * The embedded text is `clip(trimmed)` — identical to the previous (uncached)
 * implementation, so the resulting vector is byte-for-byte the same; only the
 * Gemini round-trip is now memoised per query.
 */
export async function embedQuery(
  text: string | null | undefined,
  options: { bypassCache?: boolean } = {},
): Promise<number[] | null> {
  const trimmed = text?.trim();
  if (!trimmed || !isSemanticSearchEnabled()) return null;
  const clipped = clip(trimmed);
  if (!clipped) return null;
  try {
    if (options.bypassCache) {
      const [vector] = await generateGeminiEmbedding([clipped]);
      return vector?.length === GEMINI_EMBEDDING_DIMENSIONS ? vector : null;
    }
    return await fetchCachedQueryEmbedding(clipped);
  } catch {
    return null;
  }
}
