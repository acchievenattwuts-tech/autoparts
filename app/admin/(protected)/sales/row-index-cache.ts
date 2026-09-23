/**
 * Re-key a cache that is keyed by line-item row index after row `removedIndex`
 * is removed from the list: the removed row's entry is dropped and every entry
 * after it moves down by one so it stays attached to the same product row.
 */
export const shiftRowIndexCacheAfterRemoval = <T>(
  cache: Record<number, T>,
  removedIndex: number,
): Record<number, T> => {
  const next: Record<number, T> = {};
  for (const [key, value] of Object.entries(cache)) {
    const index = Number(key);
    if (index === removedIndex) continue;
    next[index > removedIndex ? index - 1 : index] = value;
  }
  return next;
};
