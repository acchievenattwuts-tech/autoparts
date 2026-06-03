import { isLikelyNoiseQuery } from "@/lib/search-noise";
import { buildSearchVariants, normalizeSearchText } from "@/lib/search-normalization";

export type ProductSearchQualityBucket = "no-result" | "low-result";
export type ProductSearchCandidateAction =
  | "search-synonym"
  | "product-alias-oem"
  | "fitment-year"
  | "review-noise";

export type ProductSearchLogAnalysisInput = {
  query: string;
  resultCount: number;
  source: string;
  createdAt: Date;
  /** Number of times this row aggregates. Defaults to 1 for legacy rows. */
  hitCount?: number;
};

export type ProductSearchLogCluster = {
  normalizedQuery: string;
  rawQueries: string[];
  count: number;
  latestAt: Date;
  minResultCount: number;
  avgResultCount: number;
  sourceCounts: Record<string, number>;
  bucket: ProductSearchQualityBucket;
  candidateAction: ProductSearchCandidateAction;
};

export const getProductSearchQualityBucket = (resultCount: number): ProductSearchQualityBucket =>
  resultCount === 0 ? "no-result" : "low-result";

export const classifyProductSearchCandidateAction = (
  normalizedQuery: string,
): ProductSearchCandidateAction => {
  if (!normalizedQuery) return "review-noise";

  // Bot / keyboard-mashing / foreign-spam queries → flag as noise so they are
  // never treated as a real gap (and excluded from synonym auto-apply).
  if (isLikelyNoiseQuery(normalizedQuery)) return "review-noise";

  if (/\b(19|20|21)\d{2}\b/.test(normalizedQuery)) {
    return "fitment-year";
  }

  if (/[a-z]*\d+[a-z0-9-]*|[a-z0-9]+-[a-z0-9-]+/i.test(normalizedQuery)) {
    return "product-alias-oem";
  }

  if (normalizedQuery.length < 2) {
    return "review-noise";
  }

  return "search-synonym";
};

export const aggregateProductSearchLogClusters = (
  logs: ProductSearchLogAnalysisInput[],
): ProductSearchLogCluster[] => {
  const keyToGroup = new Map<string, string>();
  const grouped = new Map<
    string,
    {
      normalizedQuery: string;
      keys: Set<string>;
      rawQueries: Set<string>;
      count: number;
      latestAt: Date;
      resultTotal: number;
      minResultCount: number;
      sourceCounts: Record<string, number>;
    }
  >();

  for (const log of logs) {
    const normalizedQuery = normalizeSearchText(log.query);
    const keys = buildSearchVariants(log.query);
    if (!normalizedQuery || keys.length === 0) continue;

    const groupKey = keys.map((key) => keyToGroup.get(key)).find((key): key is string => Boolean(key)) ?? normalizedQuery;

    const existing = grouped.get(groupKey) ?? {
      normalizedQuery,
      keys: new Set<string>(),
      rawQueries: new Set<string>(),
      count: 0,
      latestAt: log.createdAt,
      resultTotal: 0,
      minResultCount: log.resultCount,
      sourceCounts: {},
    };

    const weight = log.hitCount && log.hitCount > 0 ? log.hitCount : 1;

    for (const key of keys) {
      existing.keys.add(key);
      keyToGroup.set(key, groupKey);
    }
    existing.rawQueries.add(log.query);
    existing.count += weight;
    existing.resultTotal += log.resultCount * weight;
    existing.minResultCount = Math.min(existing.minResultCount, log.resultCount);
    if (log.createdAt > existing.latestAt) existing.latestAt = log.createdAt;
    existing.sourceCounts[log.source] = (existing.sourceCounts[log.source] ?? 0) + weight;

    grouped.set(groupKey, existing);
  }

  return Array.from(grouped.values())
    .map((value) => ({
      normalizedQuery: value.normalizedQuery,
      rawQueries: Array.from(value.rawQueries).slice(0, 5),
      count: value.count,
      latestAt: value.latestAt,
      minResultCount: value.minResultCount,
      avgResultCount: value.count > 0 ? value.resultTotal / value.count : 0,
      sourceCounts: value.sourceCounts,
      bucket: getProductSearchQualityBucket(value.minResultCount),
      candidateAction: classifyProductSearchCandidateAction(value.normalizedQuery),
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.minResultCount - right.minResultCount ||
        right.latestAt.getTime() - left.latestAt.getTime(),
    );
};
