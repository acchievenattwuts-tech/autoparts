import { aggregateProductSearchLogClusters } from "@/lib/product-search-log-analysis";
import { LOW_RESULT_SEARCH_THRESHOLD } from "@/lib/product-search-telemetry";

export type ProductSearchClusterWindowKey = "last-7-days" | "last-30-days";

export type ProductSearchClusterWindowDefinition = {
  key: ProductSearchClusterWindowKey;
  label: string;
  days: number;
};

export const PRODUCT_SEARCH_CLUSTER_WINDOWS: ProductSearchClusterWindowDefinition[] = [
  { key: "last-7-days", label: "7 วันล่าสุด", days: 7 },
  { key: "last-30-days", label: "30 วันล่าสุด", days: 30 },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MATCH_TOLERANCE_MS = MS_PER_DAY;
const DEFAULT_FRESHNESS_MS = 60 * 60 * 1000;

export const getRollingWindowRange = (
  definition: ProductSearchClusterWindowDefinition,
  now: Date,
): { start: Date; end: Date } => {
  const end = now;
  const start = new Date(end.getTime() - definition.days * MS_PER_DAY);
  return { start, end };
};

export const matchRollingWindow = (
  from: Date | undefined,
  to: Date | undefined,
  now: Date,
  toleranceMs: number = DEFAULT_MATCH_TOLERANCE_MS,
): ProductSearchClusterWindowDefinition | null => {
  if (!from || !to) return null;
  for (const definition of PRODUCT_SEARCH_CLUSTER_WINDOWS) {
    const expected = getRollingWindowRange(definition, now);
    const startDiff = Math.abs(from.getTime() - expected.start.getTime());
    const endDiff = Math.abs(to.getTime() - expected.end.getTime());
    if (startDiff <= toleranceMs && endDiff <= toleranceMs) {
      return definition;
    }
  }
  return null;
};

export const isCacheFresh = (
  computedAt: Date | null | undefined,
  now: Date,
  freshnessMs: number = DEFAULT_FRESHNESS_MS,
): boolean => {
  if (!computedAt) return false;
  return now.getTime() - computedAt.getTime() <= freshnessMs;
};

type LogShape = {
  query: string;
  resultCount: number;
  source: string;
  createdAt: Date;
  hitCount?: number;
};

export const buildClusterCacheRows = (
  windowKey: ProductSearchClusterWindowKey,
  logs: LogShape[],
  range: { start: Date; end: Date },
) => {
  const clusters = aggregateProductSearchLogClusters(logs);
  return clusters.map((cluster) => ({
    windowKey,
    normalizedQuery: cluster.normalizedQuery,
    candidateAction: cluster.candidateAction,
    bucket: cluster.bucket,
    count: cluster.count,
    minResultCount: cluster.minResultCount,
    avgResultCount: Number(cluster.avgResultCount.toFixed(2)),
    latestAt: cluster.latestAt,
    rawQueriesSample: cluster.rawQueries,
    sourceCounts: cluster.sourceCounts,
    windowStart: range.start,
    windowEnd: range.end,
  }));
};

export const LOW_RESULT_THRESHOLD_FOR_CACHE = LOW_RESULT_SEARCH_THRESHOLD;
