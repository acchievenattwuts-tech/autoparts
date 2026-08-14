/**
 * Shared edit-distance primitives for typo-tolerant matching in the chat pipeline.
 *
 * Extracted from {@link ../chat-core/search-guards} so BOTH consumers use one
 * implementation:
 *  - the evidence guard (is a classifier value really something the customer typed?)
 *  - the intent hard-guard (did the customer mis-key a high-stakes keyword like
 *    "เคลม"/"สลิป"?)
 *
 * Pure, dependency-free, and unit-tested. Behaviour is byte-identical to the
 * original private helpers in search-guards.ts.
 */

/**
 * Optimal String Alignment (Damerau-Levenshtein with adjacent transpositions)
 * distance. Common Thai typos are a single edit or an adjacent character swap
 * ("คอล์ย" for "คอยล์"), so a transposition-aware distance is what recognises them.
 */
export function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) d[i][0] = i;
  for (let j = 0; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Edit budget the evidence guard allows for a target of `len` characters. */
export const typoMaxEdits = (len: number): number => Math.max(1, Math.floor(len / 4));

/**
 * True when `haystack` contains a substring within `maxEdits` of `target`.
 *
 * Slides a window over the haystack so it works on glued Thai (which is written
 * without spaces). Both strings are expected to be pre-normalized by the caller —
 * this helper does no normalization of its own, so callers stay in control of what
 * "equal" means (the evidence guard folds whitespace; the intent guard folds Thai
 * spelling).
 */
export function containsWithinEditDistance(
  target: string,
  haystack: string,
  maxEdits: number,
): boolean {
  if (!target || !haystack) return false;
  if (maxEdits <= 0) return haystack.includes(target);
  const lo = Math.max(1, target.length - maxEdits);
  const hi = target.length + maxEdits;
  for (let start = 0; start < haystack.length; start += 1) {
    for (let len = lo; len <= hi && start + len <= haystack.length; len += 1) {
      if (osaDistance(target, haystack.slice(start, start + len)) <= maxEdits) return true;
    }
  }
  return false;
}
