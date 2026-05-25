import {
  aggregateProductSearchLogClusters,
  type ProductSearchLogAnalysisInput,
} from "@/lib/product-search-log-analysis";
import { normalizeSearchText } from "@/lib/search-normalization";

export type ProductSearchQualityMetrics = {
  count: number;
  avgResultCount: number;
  latestAt: Date;
  sourceCounts: Record<string, number>;
};

export type ProductSearchClosedLoopStatus = "unmeasured" | "improved" | "unchanged" | "regressed";

export const findProductSearchQualityMetrics = (
  logs: ProductSearchLogAnalysisInput[],
  normalizedQuery: string,
): ProductSearchQualityMetrics | null => {
  const target = normalizeSearchText(normalizedQuery);
  if (!target) return null;

  const cluster = aggregateProductSearchLogClusters(logs).find((item) => item.normalizedQuery === target);
  if (!cluster) return null;

  return {
    count: cluster.count,
    avgResultCount: cluster.avgResultCount,
    latestAt: cluster.latestAt,
    sourceCounts: cluster.sourceCounts,
  };
};

export const classifyClosedLoopMeasurement = ({
  baseline,
  after,
}: {
  baseline: ProductSearchQualityMetrics | null;
  after: ProductSearchQualityMetrics | null;
}): ProductSearchClosedLoopStatus => {
  if (!baseline || baseline.count <= 0) return "unmeasured";
  if (!after || after.count === 0) return "improved";

  if (after.count < baseline.count || after.avgResultCount > baseline.avgResultCount) {
    return "improved";
  }

  if (after.count > baseline.count || after.avgResultCount < baseline.avgResultCount) {
    return "regressed";
  }

  return "unchanged";
};
