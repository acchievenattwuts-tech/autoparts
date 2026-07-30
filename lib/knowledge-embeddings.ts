import {
  GEMINI_EMBEDDING_DIMENSIONS,
  generateGeminiKnowledgeEmbedding,
  getGeminiKnowledgeEmbeddingModel,
} from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";

const MAX_KNOWLEDGE_EMBED_CHARS = 4_000;
const QUERY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const QUERY_CACHE_MAX = 500;

type CacheEntry = { vector: number[]; expiresAt: number };
const queryCache = new Map<string, CacheEntry>();

const clip = (text: string): string =>
  text.replace(/\s+/g, " ").trim().slice(0, MAX_KNOWLEDGE_EMBED_CHARS);

export function isKnowledgeRagEnabled(): boolean {
  return (
    process.env.KNOWLEDGE_RAG_ENABLED?.trim().toLowerCase() !== "off" &&
    hasGeminiKeysConfigured()
  );
}
export function getKnowledgeEmbeddingModelId(): string {
  return `${getGeminiKnowledgeEmbeddingModel()}:${GEMINI_EMBEDDING_DIMENSIONS}`;
}

export function formatKnowledgeDocumentForEmbedding(text: string): string {
  return clip(`task: question answering | document: ${text}`);
}

export function formatKnowledgeQueryForEmbedding(text: string): string {
  return clip(`task: question answering | query: ${text}`);
}

export function toKnowledgePgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function embedKnowledgeDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return generateGeminiKnowledgeEmbedding(texts.map(formatKnowledgeDocumentForEmbedding));
}

function pruneCache(now: number): void {
  for (const [key, entry] of queryCache) {
    if (entry.expiresAt <= now) queryCache.delete(key);
  }
  while (queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    queryCache.delete(oldest);
  }
}

export async function embedKnowledgeQuery(text: string): Promise<number[] | null> {
  if (!isKnowledgeRagEnabled()) return null;
  const formatted = formatKnowledgeQueryForEmbedding(text);
  if (!formatted) return null;

  const key = `${getKnowledgeEmbeddingModelId()}:${formatted}`;
  const now = Date.now();
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > now) {
    queryCache.delete(key);
    queryCache.set(key, cached);
    return cached.vector;
  }

  try {
    const [vector] = await generateGeminiKnowledgeEmbedding([formatted]);
    if (!vector || vector.length !== GEMINI_EMBEDDING_DIMENSIONS) return null;
    pruneCache(now);
    queryCache.set(key, { vector, expiresAt: now + QUERY_CACHE_TTL_MS });
    return vector;
  } catch {
    return null;
  }
}
