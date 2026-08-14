import type { ChatReplyHistoryItem, ChatSearchIntent } from "@/lib/chat-core/ai-service";
import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * In-memory TTL+LRU cache for the Gemini intent classifier
 * ({@link ../chat-core/ai-service.extractChatSearchIntent}).
 *
 * Why: the classifier runs at `temperature: 0`, so the SAME message with the SAME
 * conversation context is expected to produce the SAME classification — yet every
 * turn paid a full Gemini round-trip for it. Two things follow from caching it:
 *
 *  1. Latency. The classifier is the FIRST of several sequential Gemini calls in a
 *     product turn, and the whole turn has to land inside LINE's free reply-token
 *     window. Removing it on a repeat turn buys budget for the reply generation.
 *  2. Consistency. Even at temperature 0 the model is not bit-deterministic. A
 *     customer who retypes the same message (a common "did it go through?" habit)
 *     previously risked a different group/slot split and therefore a different
 *     answer to an identical question.
 *
 * ── Correctness rules ──────────────────────────────────────────────────────────
 *  - The key covers the WHOLE input the classifier reads: the latest text AND the
 *    bounded conversation history (role + text, in order). The classifier
 *    consolidates the subject across turns, so history is part of its input, not
 *    context colour — keying on the latest text alone would replay a stale subject.
 *  - `null` results are NEVER cached. A null means Gemini was unavailable / timed
 *    out / returned unparseable JSON; caching it would pin a transient outage onto
 *    the next few minutes of that customer's conversation.
 *  - Entries are frozen copies, so a caller mutating the returned intent (the
 *    processor does normalize `stock_availability` → `product`) cannot corrupt the
 *    cached value for the next turn.
 *  - TTL is short and the map is per-instance. This is a de-duplication window, not
 *    a source of truth; a stale entry can at worst repeat a classification the same
 *    customer got a couple of minutes ago for the identical message.
 */

/** Short enough that an admin fixing master data sees the effect almost at once. */
export const CHAT_SEARCH_INTENT_CACHE_TTL_MS = 5 * 60_000;
/** Bounded so a busy instance cannot grow the map without limit. */
export const CHAT_SEARCH_INTENT_CACHE_MAX_ENTRIES = 300;

type CacheEntry = {
  expiresAt: number;
  intent: ChatSearchIntent;
};

const cache = new Map<string, CacheEntry>();

/** Test seam — also used by nothing in production code. */
export const clearChatSearchIntentCache = (): void => {
  cache.clear();
};

/**
 * Builds the cache key from every input the classifier actually reads. Normalized
 * so trivial whitespace/case differences share an entry, and delimited with a
 * character that cannot appear in normalized text so two different splits can
 * never collide.
 */
export const buildChatSearchIntentCacheKey = (input: {
  latestText?: string | null;
  history?: ChatReplyHistoryItem[];
}): string => {
  const latest = normalizeSearchText(input.latestText);
  const history = (input.history ?? [])
    .map((turn) => `${turn.role}${normalizeSearchText(turn.text)}`)
    .join("");
  return `${latest}${history}`;
};

/** Returns a cached classification, or null when absent/expired. */
export const readChatSearchIntentCache = (
  key: string,
  now: number = Date.now(),
): ChatSearchIntent | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  // Refresh recency for the LRU eviction below.
  cache.delete(key);
  cache.set(key, entry);
  return { ...entry.intent, ...(entry.intent.subjects ? { subjects: [...entry.intent.subjects] } : {}) };
};

/** Stores a SUCCESSFUL classification. Null/undefined is ignored by design. */
export const writeChatSearchIntentCache = (
  key: string,
  intent: ChatSearchIntent | null,
  now: number = Date.now(),
  ttlMs: number = CHAT_SEARCH_INTENT_CACHE_TTL_MS,
): void => {
  if (!intent) return;
  cache.delete(key);
  cache.set(key, {
    expiresAt: now + ttlMs,
    intent: { ...intent, ...(intent.subjects ? { subjects: [...intent.subjects] } : {}) },
  });
  while (cache.size > CHAT_SEARCH_INTENT_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
};
