export type CollectionSyncPlan<TExisting extends { id: string }, TDesired> = {
  matched: Array<{ existing: TExisting; desired: TDesired }>;
  create: TDesired[];
  deleteIds: string[];
};

/**
 * Produces a stable multiset diff. Queues preserve duplicate desired rows while
 * retaining existing IDs whenever the caller's identity key is unchanged.
 */
export function planCollectionSync<TExisting extends { id: string }, TDesired>(params: {
  existing: TExisting[];
  desired: TDesired[];
  existingKey: (row: TExisting) => string;
  desiredKey: (row: TDesired) => string;
}): CollectionSyncPlan<TExisting, TDesired> {
  const available = new Map<string, TExisting[]>();
  for (const row of params.existing) {
    const key = params.existingKey(row);
    const queue = available.get(key);
    if (queue) queue.push(row);
    else available.set(key, [row]);
  }

  const matched: Array<{ existing: TExisting; desired: TDesired }> = [];
  const create: TDesired[] = [];
  for (const desired of params.desired) {
    const queue = available.get(params.desiredKey(desired));
    const existing = queue?.shift();
    if (existing) matched.push({ existing, desired });
    else create.push(desired);
  }

  return {
    matched,
    create,
    deleteIds: Array.from(available.values()).flat().map((row) => row.id),
  };
}
