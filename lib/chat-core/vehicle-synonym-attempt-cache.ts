import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * Short de-duplication window for the vehicle spell-correction attempt. Kept in its
 * own module — free of any DB import — so it unit-tests without a database, the
 * same split {@link ./category-alias-guardrails} uses.
 *
 * Customers retype constantly: the production audit trail shows the same message
 * 2–3 times in a row ("คอมแอร์50824v" ×3, "jazz ge" ×3). Without this, every repeat
 * spends another Gemini call to reach a conclusion already staged in the database,
 * and the staging upsert then no-ops.
 *
 * Per-instance and short-lived. This is a de-duplication window, not a source of
 * truth: missing it costs one redundant LLM call, never a wrong answer.
 */

const RECENT_ATTEMPT_TTL_MS = 10 * 60_000;
const RECENT_ATTEMPT_MAX_ENTRIES = 200;

const recentAttempts = new Map<string, number>();

/** Test seam. */
export const clearVehicleSynonymAttemptCache = (): void => {
  recentAttempts.clear();
};

/**
 * True when this text already went through the vehicle-correction path inside the
 * TTL window, so the caller should skip the LLM call entirely.
 *
 * Records the attempt as a side effect, so callers must only ask when they intend
 * to proceed. Empty text always returns true — there is nothing to correct.
 */
export const shouldSkipVehicleSpellingAttempt = (
  text: string | null | undefined,
  now: number = Date.now(),
): boolean => {
  const key = normalizeSearchText(text);
  if (!key) return true;

  const seenAt = recentAttempts.get(key);
  if (seenAt !== undefined && seenAt > now - RECENT_ATTEMPT_TTL_MS) return true;

  recentAttempts.set(key, now);
  // Drop expired entries first, then the oldest, so the map stays bounded.
  for (const [entry, at] of recentAttempts) {
    if (recentAttempts.size <= RECENT_ATTEMPT_MAX_ENTRIES) break;
    if (at <= now - RECENT_ATTEMPT_TTL_MS) recentAttempts.delete(entry);
  }
  while (recentAttempts.size > RECENT_ATTEMPT_MAX_ENTRIES) {
    const oldest = recentAttempts.keys().next();
    if (oldest.done) break;
    recentAttempts.delete(oldest.value);
  }
  return false;
};
