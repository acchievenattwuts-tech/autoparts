import { generateGeminiEmbedding, GEMINI_EMBEDDING_DIMENSIONS } from "@/lib/google-ai-client";
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

/**
 * Embeds a single query string for semantic search. Returns null (never throws)
 * when semantic search is disabled, the input is empty, or embedding fails — the
 * caller then runs lexical-only search.
 */
export async function embedQuery(text: string | null | undefined): Promise<number[] | null> {
  const trimmed = text?.trim();
  if (!trimmed || !isSemanticSearchEnabled()) return null;
  try {
    const [vector] = await generateGeminiEmbedding([clip(trimmed)]);
    return vector && vector.length === GEMINI_EMBEDDING_DIMENSIONS ? vector : null;
  } catch {
    return null;
  }
}
