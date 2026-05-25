export const dynamic = "force-dynamic";

import Link from "next/link";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { db } from "@/lib/db";
import { ProductSearchReviewStatus as PrismaProductSearchReviewStatus } from "@/lib/generated/prisma";
import {
  buildAutoApplySearchSynonymPlan,
  type ProductSearchAutoApplyReason,
} from "@/lib/product-search-auto-apply";
import {
  classifyClosedLoopMeasurement,
  findProductSearchQualityMetrics,
  type ProductSearchClosedLoopStatus,
  type ProductSearchQualityMetrics,
} from "@/lib/product-search-closed-loop";
import { parseFitmentYearHint } from "@/lib/product-search-fitment-remediation";
import {
  aggregateProductSearchLogClusters,
  type ProductSearchCandidateAction,
  type ProductSearchLogCluster,
  type ProductSearchQualityBucket,
} from "@/lib/product-search-log-analysis";
import {
  PRODUCT_SEARCH_CLUSTER_WINDOWS,
  isCacheFresh,
  matchRollingWindow,
} from "@/lib/product-search-cluster-cache";
import { LOW_RESULT_SEARCH_THRESHOLD } from "@/lib/product-search-telemetry";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import {
  formatDateTimeThai,
  getThailandDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";
import {
  autoApplySearchSynonymCandidates,
  applyProductAliasCandidate,
  applyProductFitmentCandidate,
  applySearchSynonymCandidate,
  markProductSearchReviewOutcome,
  refreshProductSearchClusterCache,
} from "./actions";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const RECENT_LIMIT = 100;
const CLUSTER_LIMIT = 20;
const ANALYSIS_LIMIT = 500;

const parseDateParam = (value: string | undefined, boundary: "start" | "end"): Date | undefined => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return boundary === "start" ? parseDateOnlyToStartOfDay(value) : parseDateOnlyToEndOfDay(value);
};

const getFilterLabel = (filters: unknown): string => {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return "-";

  const entries = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);

  return entries.length > 0 ? entries.join(" | ") : "-";
};

const getSourceLabel = (source: string): string => (source === "storefront" ? "หน้าร้าน" : "หลังบ้าน");

const getBucketLabel = (bucket: ProductSearchQualityBucket): string =>
  bucket === "no-result" ? "No-result" : "Low-result";

const getActionLabel = (action: ProductSearchCandidateAction): string => {
  const labels: Record<ProductSearchCandidateAction, string> = {
    "search-synonym": "เพิ่ม SearchSynonym",
    "product-alias-oem": "ตรวจ ProductAlias/OEM",
    "fitment-year": "ตรวจ fitment/year",
    "review-noise": "ตรวจว่าเป็น noise",
  };
  return labels[action];
};

const aliasKindOptions = ["OEM", "PART_NO", "CROSS_REF", "ALIAS", "KEYWORD", "MISSPELL"] as const;
const outcomeStatusOptions = ["all", "pending", "applied", "ignored", "needs-investigation", "duplicate"] as const;

type OutcomeStatusFilter = (typeof outcomeStatusOptions)[number];

const getDefaultAliasKind = (action: ProductSearchCandidateAction): (typeof aliasKindOptions)[number] =>
  action === "product-alias-oem" ? "OEM" : "ALIAS";

const prismaStatusToFilter: Record<PrismaProductSearchReviewStatus, OutcomeStatusFilter> = {
  PENDING: "pending",
  APPLIED: "applied",
  IGNORED: "ignored",
  NEEDS_INVESTIGATION: "needs-investigation",
  DUPLICATE: "duplicate",
};

const getReviewStatusLabel = (status?: PrismaProductSearchReviewStatus): string => {
  if (!status) return "Pending";
  const labels: Record<PrismaProductSearchReviewStatus, string> = {
    PENDING: "Pending",
    APPLIED: "Applied",
    IGNORED: "Ignored",
    NEEDS_INVESTIGATION: "Needs investigation",
    DUPLICATE: "Duplicate",
  };
  return labels[status];
};

const getReviewStatusClass = (status?: PrismaProductSearchReviewStatus): string => {
  const key = status ?? PrismaProductSearchReviewStatus.PENDING;
  const classes: Record<PrismaProductSearchReviewStatus, string> = {
    PENDING: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-slate-200",
    APPLIED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200",
    IGNORED: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
    NEEDS_INVESTIGATION: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200",
    DUPLICATE: "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-200",
  };
  return classes[key];
};

const getClosedLoopLabel = (status: ProductSearchClosedLoopStatus): string => {
  const labels: Record<ProductSearchClosedLoopStatus, string> = {
    unmeasured: "Unmeasured",
    improved: "Improved",
    unchanged: "Unchanged",
    regressed: "Regressed",
  };
  return labels[status];
};

const getClosedLoopClass = (status: ProductSearchClosedLoopStatus): string => {
  const classes: Record<ProductSearchClosedLoopStatus, string> = {
    unmeasured: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-slate-200",
    improved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200",
    unchanged: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200",
    regressed: "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200",
  };
  return classes[status];
};

const getAutoApplyReasonLabel = (reason: ProductSearchAutoApplyReason): string => {
  const labels: Record<ProductSearchAutoApplyReason, string> = {
    ELIGIBLE: "Eligible",
    UNSUPPORTED_CANDIDATE_ACTION: "Excluded: not SearchSynonym",
    ALREADY_REVIEWED: "Excluded: already reviewed",
    QUERY_TOO_SHORT: "Excluded: query too short",
    NUMERIC_OR_CODE_LIKE_QUERY: "Excluded: numeric/code-like query",
    NO_SYNONYM_VARIANTS: "Excluded: no synonym variant",
    DUPLICATE_SYNONYM: "Excluded: duplicate synonym",
    MAX_SYNONYMS_REACHED: "Excluded: max synonyms reached",
  };
  return labels[reason];
};

export default async function ProductSearchNoResultPage({ searchParams }: PageProps) {
  await requirePermission("product_search_report.view");

  const params = await searchParams;
  const today = getThailandDateKey();
  const fromInput = params.from || "";
  const toInput = params.to || today;
  const source = params.source || "";
  const quality = params.quality || "all";
  const search = params.search?.trim() || "";
  const outcomeStatus = outcomeStatusOptions.includes(params.outcomeStatus as OutcomeStatusFilter)
    ? (params.outcomeStatus as OutcomeStatusFilter)
    : "all";
  const autoApplyDryRun = params.autoApplyDryRun === "1";
  const autoApplyEnabled = await getSiteConfig()
    .then((config) => config.productSearchAutoApplySynonymsEnabled)
    .catch(() => false);
  const f2Applied = params.f2Applied || "";
  const f2Error = params.f2Error || "";
  const returnParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "f2Applied" && key !== "f2Error") returnParams.set(key, value);
  }
  const returnTo = `/admin/reports/product-search-no-result${returnParams.size ? `?${returnParams}` : ""}`;

  const from = parseDateParam(fromInput, "start");
  const to = parseDateParam(toInput, "end");
  const resultCountWhere =
    quality === "no-result"
      ? { resultCount: 0 }
      : quality === "low-result"
        ? { resultCount: { gt: 0, lte: LOW_RESULT_SEARCH_THRESHOLD } }
        : { resultCount: { lte: LOW_RESULT_SEARCH_THRESHOLD } };

  const where = {
    ...resultCountWhere,
    ...(source ? { source } : {}),
    ...(search ? { query: { contains: search, mode: "insensitive" as const } } : {}),
    ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const [
    logs,
    analysisLogs,
    logCountGroups,
    outcomeStatusGroups,
    carBrands,
  ] = await Promise.all([
    db.productSearchLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
    }),
    db.productSearchLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: ANALYSIS_LIMIT,
      select: { query: true, resultCount: true, source: true, createdAt: true, hitCount: true },
    }),
    db.productSearchLog.groupBy({
      by: ["source", "resultCount"],
      where,
      _count: { _all: true },
    }),
    // Dep 2A: count outcomes whose reviewedAt falls in the report's date filter
    // (semantic = "review activity in this period"). Independent of which logs
    // exist — useful for tracking admin throughput.
    db.productSearchReviewOutcome.groupBy({
      by: ["status"],
      where: (from || to)
        ? { reviewedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {},
      _count: { _all: true },
    }),
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        carModels: {
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
  ]);

  // Aggregate the 5 log counts from a single groupBy result instead of 5 separate queries.
  let total = 0;
  let noResultTotal = 0;
  let lowResultTotal = 0;
  let storefrontTotal = 0;
  let adminTotal = 0;
  for (const group of logCountGroups) {
    const count = group._count._all;
    total += count;
    if (group.resultCount === 0) noResultTotal += count;
    else if (group.resultCount <= LOW_RESULT_SEARCH_THRESHOLD) lowResultTotal += count;
    if (group.source === "storefront") storefrontTotal += count;
    else if (group.source === "admin") adminTotal += count;
  }

  const outcomeStatusCounts: Record<PrismaProductSearchReviewStatus, number> = {
    PENDING: 0,
    APPLIED: 0,
    IGNORED: 0,
    NEEDS_INVESTIGATION: 0,
    DUPLICATE: 0,
  };
  for (const group of outcomeStatusGroups) {
    outcomeStatusCounts[group.status] = group._count._all;
  }
  // Dep 2A — outcomes reviewed inside the report date window.
  const outcomeReviewedPendingTotal = outcomeStatusCounts.PENDING;
  const outcomeReviewedAppliedTotal = outcomeStatusCounts.APPLIED;
  const outcomeReviewedIgnoredTotal = outcomeStatusCounts.IGNORED;
  const outcomeReviewedNeedsInvestigationTotal = outcomeStatusCounts.NEEDS_INVESTIGATION;
  const outcomeReviewedDuplicateTotal = outcomeStatusCounts.DUPLICATE;

  // Dep 1 — Materialized cluster cache. If the admin's date filter matches one
  // of the rolling windows (last-7-days / last-30-days) AND a fresh cache row
  // set exists, read clusters from the cache (covers ALL clusters, not just
  // the top 500 from the live aggregation). Otherwise, fall back to in-memory
  // aggregation over `analysisLogs`.
  const nowForCache = new Date();
  const matchedWindow = matchRollingWindow(from, to, nowForCache);
  const cachedRows = matchedWindow
    ? await db.productSearchClusterCache.findMany({
        where: { windowKey: matchedWindow.key },
        orderBy: [{ count: "desc" }, { latestAt: "desc" }],
      })
    : [];
  const cacheComputedAt = cachedRows[0]?.computedAt ?? null;
  const useCache = matchedWindow !== null && cachedRows.length > 0 && isCacheFresh(cacheComputedAt, nowForCache);
  const cacheStaleButPresent = matchedWindow !== null && cachedRows.length > 0 && !useCache;
  const rawClusters: ProductSearchLogCluster[] = useCache
    ? cachedRows.map((row) => ({
        normalizedQuery: row.normalizedQuery,
        rawQueries: Array.isArray(row.rawQueriesSample) ? (row.rawQueriesSample as string[]) : [],
        count: row.count,
        latestAt: row.latestAt,
        minResultCount: row.minResultCount,
        avgResultCount: Number(row.avgResultCount),
        sourceCounts:
          row.sourceCounts && typeof row.sourceCounts === "object" && !Array.isArray(row.sourceCounts)
            ? (row.sourceCounts as Record<string, number>)
            : {},
        bucket: row.bucket as ProductSearchQualityBucket,
        candidateAction: row.candidateAction as ProductSearchCandidateAction,
      }))
    : aggregateProductSearchLogClusters(analysisLogs);
  const outcomeKeys = rawClusters.map((cluster) => ({
    normalizedQuery: cluster.normalizedQuery,
    candidateAction: cluster.candidateAction,
  }));
  const outcomes = outcomeKeys.length
    ? await db.productSearchReviewOutcome.findMany({
        where: { OR: outcomeKeys },
      })
    : [];
  // Dep 2B — count outcomes whose normalizedQuery appears in the filtered log
  // window. Derived from already-loaded `outcomes` (no extra DB query).
  const outcomeInRangeCounts: Record<PrismaProductSearchReviewStatus, number> = {
    PENDING: 0,
    APPLIED: 0,
    IGNORED: 0,
    NEEDS_INVESTIGATION: 0,
    DUPLICATE: 0,
  };
  for (const outcome of outcomes) {
    outcomeInRangeCounts[outcome.status] += 1;
  }
  const outcomeInRangePendingTotal = outcomeInRangeCounts.PENDING;
  const outcomeInRangeAppliedTotal = outcomeInRangeCounts.APPLIED;
  const outcomeInRangeIgnoredTotal = outcomeInRangeCounts.IGNORED;
  const outcomeInRangeNeedsInvestigationTotal = outcomeInRangeCounts.NEEDS_INVESTIGATION;
  const outcomeInRangeDuplicateTotal = outcomeInRangeCounts.DUPLICATE;
  const outcomeMap = new Map(
    outcomes.map((outcome) => [`${outcome.normalizedQuery}\u0000${outcome.candidateAction}`, outcome]),
  );
  const clusters = rawClusters
    .filter((cluster) => {
      if (outcomeStatus === "all") return true;
      const outcome = outcomeMap.get(`${cluster.normalizedQuery}\u0000${cluster.candidateAction}`);
      if (outcomeStatus === "pending") return !outcome || outcome.status === PrismaProductSearchReviewStatus.PENDING;
      return outcome ? prismaStatusToFilter[outcome.status] === outcomeStatus : false;
    })
    .slice(0, CLUSTER_LIMIT);
  const appliedOutcomes = clusters
    .map((cluster) => outcomeMap.get(`${cluster.normalizedQuery}\u0000${cluster.candidateAction}`))
    .filter((outcome): outcome is NonNullable<typeof outcome> => Boolean(outcome?.reviewedAt));
  const minReviewedAt = appliedOutcomes.reduce<Date | null>(
    (min, outcome) => (!min || outcome.reviewedAt! < min ? outcome.reviewedAt! : min),
    null,
  );
  const afterMeasurementLogs = minReviewedAt
    ? await db.productSearchLog.findMany({
        where: {
          resultCount: { lte: LOW_RESULT_SEARCH_THRESHOLD },
          createdAt: { gte: minReviewedAt },
        },
        orderBy: { createdAt: "desc" },
        take: ANALYSIS_LIMIT,
        select: { query: true, resultCount: true, source: true, createdAt: true, hitCount: true },
      })
    : [];
  const closedLoopMap = new Map<
    string,
    {
      status: ProductSearchClosedLoopStatus;
      baseline: ProductSearchQualityMetrics | null;
      after: ProductSearchQualityMetrics | null;
    }
  >();

  for (const cluster of clusters) {
    const key = `${cluster.normalizedQuery}\u0000${cluster.candidateAction}`;
    const outcome = outcomeMap.get(key);
    const baseline =
      outcome?.baselineCount && outcome.baselineAvg !== null && outcome.baselineLatestAt
        ? {
            count: outcome.baselineCount,
            avgResultCount: outcome.baselineAvg,
            latestAt: outcome.baselineLatestAt,
            sourceCounts:
              outcome.baselineSources && typeof outcome.baselineSources === "object" && !Array.isArray(outcome.baselineSources)
                ? (outcome.baselineSources as Record<string, number>)
                : {},
          }
        : null;
    const after =
      outcome?.status === PrismaProductSearchReviewStatus.APPLIED && outcome.reviewedAt
        ? findProductSearchQualityMetrics(
            afterMeasurementLogs.filter((log) => log.createdAt > outcome.reviewedAt!),
            cluster.normalizedQuery,
          )
        : null;
    closedLoopMap.set(key, {
      status: classifyClosedLoopMeasurement({ baseline, after }),
      baseline,
      after,
    });
  }

  const closedLoopSummary = Array.from(closedLoopMap.values()).reduce(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { improved: 0, unchanged: 0, regressed: 0, unmeasured: 0 } satisfies Record<ProductSearchClosedLoopStatus, number>,
  );
  const autoApplyDryRunUrl = (() => {
    const next = new URLSearchParams(returnParams);
    next.set("autoApplyDryRun", "1");
    return `/admin/reports/product-search-no-result?${next}`;
  })();
  const autoApplyReturnParams = new URLSearchParams(returnParams);
  autoApplyReturnParams.set("autoApplyDryRun", "1");
  const autoApplyReturnTo = `/admin/reports/product-search-no-result?${autoApplyReturnParams}`;
  const autoApplySynonyms = autoApplyDryRun
    ? await db.searchSynonym.findMany({
        select: { id: true, term: true, synonyms: true, language: true, isActive: true },
      })
    : [];
  const autoApplyPlan = autoApplyDryRun
    ? buildAutoApplySearchSynonymPlan({
        clusters,
        existingSynonyms: autoApplySynonyms,
        outcomeByKey: new Map(
          outcomes.map((outcome) => [
            `${outcome.normalizedQuery}\u0000${outcome.candidateAction}`,
            { status: outcome.status },
          ]),
        ),
      })
    : [];
  const autoApplyEligibleItems = autoApplyPlan.filter((item) => item.eligible);
  const autoApplyCandidatesJson = JSON.stringify(
    autoApplyEligibleItems.map((item) => ({
      normalizedQuery: item.normalizedQuery,
      rawQueries: item.rawQueries,
    })),
  );

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Product Search Quality"
        description={`ติดตามคำค้นหาที่ไม่พบผลลัพธ์และคำค้นหาที่ได้ผลลัพธ์น้อยกว่า ${LOW_RESULT_SEARCH_THRESHOLD} รายการ เพื่อใช้ปรับ SearchSynonym, ProductAlias/OEM และ fitment`}
      />

      {f2Applied ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100">
          {f2Applied}
        </div>
      ) : null}
      {f2Error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-100">
          {f2Error}
        </div>
      ) : null}

      <AdminSearchForm method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={fromInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={toInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ประเภท
          <select
            name="quality"
            defaultValue={quality}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">No + Low result</option>
            <option value="no-result">No-result เท่านั้น</option>
            <option value="low-result">Low-result เท่านั้น</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          Review status
          <select
            name="outcomeStatus"
            defaultValue={outcomeStatus}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="applied">Applied</option>
            <option value="ignored">Ignored</option>
            <option value="needs-investigation">Needs investigation</option>
            <option value="duplicate">Duplicate</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          แหล่งที่มา
          <select
            name="source"
            defaultValue={source}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทั้งหมด</option>
            <option value="storefront">หน้าร้าน</option>
            <option value="admin">หลังบ้าน</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          คำค้น
          <input
            type="text"
            name="search"
            defaultValue={search}
            placeholder="ค้นหาในคำค้น"
            className="h-9 w-[18rem] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] dark:bg-sky-700 dark:hover:bg-sky-600">
          แสดงรายการ
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/product-search-no-result"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ล้าง
        </Link>
      </AdminSearchForm>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <p className="text-xs text-gray-500 dark:text-slate-400">รวมตามตัวกรอง</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{total.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm dark:border-rose-400/20 dark:bg-rose-400/10">
          <p className="text-xs text-rose-700 dark:text-rose-200">No-result</p>
          <p className="font-kanit text-2xl font-bold text-rose-800 dark:text-rose-100">{noResultTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 shadow-sm dark:border-orange-400/20 dark:bg-orange-400/10">
          <p className="text-xs text-orange-700 dark:text-orange-200">Low-result</p>
          <p className="font-kanit text-2xl font-bold text-orange-800 dark:text-orange-100">{lowResultTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4 shadow-sm dark:border-cyan-400/20 dark:bg-cyan-400/10">
          <p className="text-xs text-cyan-700 dark:text-cyan-200">หน้าร้าน</p>
          <p className="font-kanit text-2xl font-bold text-cyan-800 dark:text-cyan-100">{storefrontTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10">
          <p className="text-xs text-amber-700 dark:text-amber-200">หลังบ้าน</p>
          <p className="font-kanit text-2xl font-bold text-amber-800 dark:text-amber-100">{adminTotal.toLocaleString("th-TH")}</p>
        </div>
      </div>

      <div
        className="grid gap-3 md:grid-cols-5"
        title="ตัวเลขหลัก = review outcome ของ normalized query ที่อยู่ในช่วงตัวกรองด้านบน (Dep 2B); ตัวเลขรองในวงเล็บ = review ที่ทำในช่วงเดียวกัน (Dep 2A)"
      >
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <p className="text-xs text-gray-500 dark:text-slate-400">Review pending (in range)</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{outcomeInRangePendingTotal.toLocaleString("th-TH")}</p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">Reviewed in range: {outcomeReviewedPendingTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-400/10">
          <p className="text-xs text-emerald-700 dark:text-emerald-200">Applied (in range)</p>
          <p className="font-kanit text-2xl font-bold text-emerald-800 dark:text-emerald-100">{outcomeInRangeAppliedTotal.toLocaleString("th-TH")}</p>
          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-200/80">Reviewed in range: {outcomeReviewedAppliedTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <p className="text-xs text-slate-600 dark:text-slate-300">Ignored (in range)</p>
          <p className="font-kanit text-2xl font-bold text-slate-800 dark:text-slate-100">{outcomeInRangeIgnoredTotal.toLocaleString("th-TH")}</p>
          <p className="text-[11px] text-slate-600/80 dark:text-slate-300/80">Reviewed in range: {outcomeReviewedIgnoredTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10">
          <p className="text-xs text-amber-700 dark:text-amber-200">Needs investigation (in range)</p>
          <p className="font-kanit text-2xl font-bold text-amber-800 dark:text-amber-100">{outcomeInRangeNeedsInvestigationTotal.toLocaleString("th-TH")}</p>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-200/80">Reviewed in range: {outcomeReviewedNeedsInvestigationTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4 shadow-sm dark:border-cyan-400/20 dark:bg-cyan-400/10">
          <p className="text-xs text-cyan-700 dark:text-cyan-200">Duplicate (in range)</p>
          <p className="font-kanit text-2xl font-bold text-cyan-800 dark:text-cyan-100">{outcomeInRangeDuplicateTotal.toLocaleString("th-TH")}</p>
          <p className="text-[11px] text-cyan-700/80 dark:text-cyan-200/80">Reviewed in range: {outcomeReviewedDuplicateTotal.toLocaleString("th-TH")}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-400/10">
          <p className="text-xs text-emerald-700 dark:text-emerald-200">Closed-loop improved</p>
          <p className="font-kanit text-2xl font-bold text-emerald-800 dark:text-emerald-100">{closedLoopSummary.improved.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10">
          <p className="text-xs text-amber-700 dark:text-amber-200">Closed-loop unchanged</p>
          <p className="font-kanit text-2xl font-bold text-amber-800 dark:text-amber-100">{closedLoopSummary.unchanged.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm dark:border-rose-400/20 dark:bg-rose-400/10">
          <p className="text-xs text-rose-700 dark:text-rose-200">Closed-loop regressed</p>
          <p className="font-kanit text-2xl font-bold text-rose-800 dark:text-rose-100">{closedLoopSummary.regressed.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <p className="text-xs text-gray-500 dark:text-slate-400">Closed-loop unmeasured</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{closedLoopSummary.unmeasured.toLocaleString("th-TH")}</p>
        </div>
      </div>

      <section className="rounded-xl border border-sky-100 bg-sky-50 p-4 shadow-sm dark:border-sky-400/20 dark:bg-sky-400/10">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <h2 className="font-kanit text-base font-semibold text-sky-950 dark:text-sky-100">Guarded Auto-Apply</h2>
            <p className="max-w-3xl text-xs text-sky-800 dark:text-sky-200">
              Dry-run เฉพาะ candidate แบบ SearchSynonym ที่เสี่ยงต่ำเท่านั้น: ไม่แตะ ProductAlias/OEM, fitment/year, query ที่มีตัวเลขหรือรูปแบบ code และไม่เขียนข้อมูลจนกว่าจะเปิดจากตั้งค่าร้านค้า
            </p>
            <p className="text-xs font-medium text-sky-900 dark:text-sky-100">
              Admin setting: {autoApplyEnabled ? "enabled" : "disabled"} ({autoApplyEnabled ? "เขียนจริงได้หลัง dry-run" : "แสดง dry-run ได้เท่านั้น"})
            </p>
          </div>
          <Link
            href={autoApplyDryRunUrl}
            className="inline-flex h-9 items-center justify-center rounded-md bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            Run dry-run
          </Link>
        </div>

        {autoApplyDryRun ? (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/70 bg-white p-3 dark:border-white/10 dark:bg-slate-950/60">
                <p className="text-xs text-gray-500 dark:text-slate-400">Eligible</p>
                <p className="font-kanit text-2xl font-bold text-emerald-700 dark:text-emerald-200">{autoApplyEligibleItems.length.toLocaleString("th-TH")}</p>
              </div>
              <div className="rounded-lg border border-white/70 bg-white p-3 dark:border-white/10 dark:bg-slate-950/60">
                <p className="text-xs text-gray-500 dark:text-slate-400">Rejected by guard</p>
                <p className="font-kanit text-2xl font-bold text-amber-700 dark:text-amber-200">{(autoApplyPlan.length - autoApplyEligibleItems.length).toLocaleString("th-TH")}</p>
              </div>
              <div className="rounded-lg border border-white/70 bg-white p-3 dark:border-white/10 dark:bg-slate-950/60">
                <p className="text-xs text-gray-500 dark:text-slate-400">Write mode</p>
                <p className="font-kanit text-lg font-bold text-gray-900 dark:text-slate-100">{autoApplyEnabled ? "Available" : "Dry-run only"}</p>
              </div>
            </div>

            {autoApplyEligibleItems.length > 0 ? (
              <form action={autoApplySearchSynonymCandidates} className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-400/20 dark:bg-emerald-400/10">
                <input type="hidden" name="candidates" value={autoApplyCandidatesJson} />
                <input type="hidden" name="returnTo" value={autoApplyReturnTo} />
                <p className="text-xs text-emerald-800 dark:text-emerald-100">
                  Apply จะสร้าง/อัปเดต SearchSynonym, บันทึก audit log, mark outcome เป็น applied และใส่ rollback note ให้ทุกรายการ
                </p>
                <button
                  type="submit"
                  disabled={!autoApplyEnabled}
                  className="h-8 rounded-md bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500"
                >
                  Auto-apply eligible
                </button>
              </form>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-white/70 bg-white dark:border-white/10 dark:bg-slate-950/60">
              <table className="w-full text-xs">
                <thead className="bg-sky-900 text-white dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Query</th>
                    <th className="px-3 py-2 text-left font-medium">Synonyms to add</th>
                    <th className="px-3 py-2 text-left font-medium">Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                  {autoApplyPlan.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-5 text-center text-gray-400 dark:text-slate-500">
                        No clusters in current filter
                      </td>
                    </tr>
                  ) : (
                    autoApplyPlan.map((item) => (
                      <tr key={`${item.normalizedQuery}-${item.candidateAction}`} className="hover:bg-gray-50 dark:hover:bg-white/5">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-100">{item.normalizedQuery}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{item.synonymsToAdd.length ? item.synonymsToAdd.join(" | ") : "-"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-1 font-medium ${item.eligible ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200"}`}>
                            {getAutoApplyReasonLabel(item.reason)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-violet-100 bg-violet-50 p-4 shadow-sm dark:border-violet-400/20 dark:bg-violet-400/10">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <h2 className="font-kanit text-base font-semibold text-violet-950 dark:text-violet-100">Cluster cache (rolling windows)</h2>
            <p className="max-w-3xl text-xs text-violet-800 dark:text-violet-200">
              Cache cluster aggregation สำหรับช่วง {PRODUCT_SEARCH_CLUSTER_WINDOWS.map((w) => w.label).join(" / ")} — เมื่อตัวกรองวันที่ตรงกับช่วง cache ที่ fresh (&lt;1 ชม.) หน้านี้จะข้าม in-memory aggregation 500 แถวและอ่านจาก cache แทน ครอบคลุม cluster ทั้งหมด ไม่ใช่แค่ top 500
            </p>
            <p className="text-xs font-medium text-violet-900 dark:text-violet-100">
              สถานะปัจจุบัน: {matchedWindow
                ? useCache
                  ? `กำลังใช้ cache "${matchedWindow.label}" (${cachedRows.length} clusters, computed ${cacheComputedAt ? formatDateTimeThai(cacheComputedAt) : "-"})`
                  : cacheStaleButPresent
                    ? `Cache "${matchedWindow.label}" หมดอายุแล้ว — ใช้ live aggregation อยู่`
                    : `Cache "${matchedWindow.label}" ยังไม่ถูกสร้าง — ใช้ live aggregation อยู่`
                : "ตัวกรองวันที่ไม่ตรงกับ rolling window — ใช้ live aggregation"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRODUCT_SEARCH_CLUSTER_WINDOWS.map((window) => (
              <form key={window.key} action={refreshProductSearchClusterCache}>
                <input type="hidden" name="windowKey" value={window.key} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  className="h-9 rounded-md bg-violet-700 px-3 text-xs font-medium text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500"
                >
                  Refresh {window.label}
                </button>
              </form>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/80">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">Top normalized query clusters</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            รวม query ที่สะกด/เว้นวรรค/เครื่องหมายต่างกันให้อยู่กลุ่มเดียวกัน แสดงสูงสุด {CLUSTER_LIMIT} กลุ่ม{useCache ? ` จาก cache "${matchedWindow?.label ?? ""}" (${cachedRows.length} clusters ทั้งหมด)` : `จากรายการล่าสุด ${ANALYSIS_LIMIT} รายการ (live aggregation)`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Normalized query</th>
                <th className="px-3 py-2.5 text-left font-medium">Raw variants</th>
                <th className="px-3 py-2.5 text-right font-medium">ครั้ง</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg result</th>
                <th className="px-3 py-2.5 text-left font-medium">ประเภท</th>
                <th className="px-3 py-2.5 text-left font-medium">Action ที่ควรตรวจ</th>
                <th className="px-3 py-2.5 text-left font-medium">ล่าสุด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {clusters.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                    ไม่มีข้อมูลตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                clusters.map((cluster) => {
                  const closedLoopKey = `${cluster.normalizedQuery}\u0000${cluster.candidateAction}`;
                  const outcome = outcomeMap.get(closedLoopKey);
                  const closedLoop = closedLoopMap.get(closedLoopKey);
                  const fitmentYearHint = parseFitmentYearHint(cluster.normalizedQuery);

                  return (
                  <tr key={cluster.normalizedQuery} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="max-w-[18rem] px-3 py-2">
                      <div className="space-y-1">
                        <p className="font-medium text-gray-900 dark:text-slate-100">{cluster.normalizedQuery}</p>
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getReviewStatusClass(outcome?.status)}`}>
                          {getReviewStatusLabel(outcome?.status)}
                        </span>
                        {outcome?.note ? (
                          <p className="line-clamp-2 text-xs text-gray-500 dark:text-slate-400">{outcome.note}</p>
                        ) : null}
                        {closedLoop ? (
                          <div className="space-y-1">
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getClosedLoopClass(closedLoop.status)}`}>
                              {getClosedLoopLabel(closedLoop.status)}
                            </span>
                            <p className="text-[11px] text-gray-500 dark:text-slate-400">
                              Before {closedLoop.baseline?.count ?? "-"} / After {closedLoop.after?.count ?? 0}
                            </p>
                            {closedLoop.after && closedLoop.after.count > 0 ? (
                              <p className="text-[11px] font-medium text-rose-600 dark:text-rose-200">Still has low/no-result logs</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="max-w-[24rem] px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{cluster.rawQueries.join(" | ")}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{cluster.count.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{cluster.avgResultCount.toFixed(1)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-white/10 dark:text-slate-200">
                        {getBucketLabel(cluster.bucket)}
                      </span>
                    </td>
                    <td className="min-w-[24rem] px-3 py-2 text-gray-700 dark:text-slate-200">
                      <div className="space-y-2">
                        <span className="inline-flex rounded-full bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
                          {getActionLabel(cluster.candidateAction)}
                        </span>
                        {cluster.candidateAction === "search-synonym" ? (
                          <form action={applySearchSynonymCandidate} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 dark:border-white/10 dark:bg-white/5">
                            <input type="hidden" name="candidate" value={cluster.rawQueries[0] || cluster.normalizedQuery} />
                            <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                            <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Term
                              <input
                                name="term"
                                defaultValue=""
                                placeholder="canonical term"
                                className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Lang
                              <input
                                name="language"
                                defaultValue=""
                                placeholder="th/en"
                                className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <button
                              type="submit"
                              className="h-8 rounded-md bg-[#1e3a5f] px-3 text-xs font-medium text-white hover:bg-[#163055] dark:bg-sky-700 dark:hover:bg-sky-600"
                            >
                              Apply
                            </button>
                          </form>
                        ) : null}
                        {cluster.candidateAction === "product-alias-oem" ? (
                          <form action={applyProductAliasCandidate} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 dark:border-white/10 dark:bg-white/5">
                            <input type="hidden" name="alias" value={cluster.rawQueries[0] || cluster.normalizedQuery} />
                            <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                            <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Product code
                              <input
                                name="productCode"
                                placeholder="exact code"
                                className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Kind
                              <select
                                name="kind"
                                defaultValue={getDefaultAliasKind(cluster.candidateAction)}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              >
                                {aliasKindOptions.map((kind) => (
                                  <option key={kind} value={kind}>
                                    {kind}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="submit"
                              className="h-8 rounded-md bg-[#1e3a5f] px-3 text-xs font-medium text-white hover:bg-[#163055] dark:bg-sky-700 dark:hover:bg-sky-600"
                            >
                              Add alias
                            </button>
                          </form>
                        ) : null}
                        {cluster.candidateAction === "fitment-year" ? (
                          <form action={applyProductFitmentCandidate} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 dark:border-white/10 dark:bg-white/5">
                            <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                            <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Product code
                              <input
                                name="productCode"
                                placeholder="exact code"
                                className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Car model
                              <SearchableSelectFilter
                                name="carModelId"
                                options={carBrands.flatMap((brand) =>
                                  brand.carModels.map((model) => ({
                                    id: model.id,
                                    label: `${brand.name} / ${model.name}`,
                                    sublabel: brand.name,
                                  })),
                                )}
                                placeholder="Select model"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Year start
                              <input
                                name="yearStart"
                                type="number"
                                min={1900}
                                max={2200}
                                defaultValue={fitmentYearHint.yearStart ?? ""}
                                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Year end
                              <input
                                name="yearEnd"
                                type="number"
                                min={1900}
                                max={2200}
                                defaultValue={fitmentYearHint.yearEnd ?? ""}
                                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Submodel
                              <input
                                name="submodel"
                                placeholder="optional"
                                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              Engine
                              <input
                                name="engineCode"
                                placeholder="optional"
                                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                              />
                            </label>
                            <button
                              type="submit"
                              className="h-8 rounded-md bg-[#1e3a5f] px-3 text-xs font-medium text-white hover:bg-[#163055] dark:bg-sky-700 dark:hover:bg-sky-600"
                            >
                              Add fitment
                            </button>
                          </form>
                        ) : null}
                        <form action={markProductSearchReviewOutcome} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-200 p-2 dark:border-white/15">
                          <input type="hidden" name="normalizedQuery" value={cluster.normalizedQuery} />
                          <input type="hidden" name="candidateAction" value={cluster.candidateAction} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <label className="flex flex-col gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                            Note
                            <input
                              name="note"
                              defaultValue={outcome?.note ?? ""}
                              placeholder="optional"
                              className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:text-slate-100"
                            />
                          </label>
                          <button
                            type="submit"
                            name="status"
                            value="ignored"
                            className="h-8 rounded-md bg-slate-100 px-2 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
                          >
                            Ignore
                          </button>
                          <button
                            type="submit"
                            name="status"
                            value="needs-investigation"
                            className="h-8 rounded-md bg-amber-100 px-2 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20"
                          >
                            Investigate
                          </button>
                          <button
                            type="submit"
                            name="status"
                            value="duplicate"
                            className="h-8 rounded-md bg-cyan-100 px-2 text-xs font-medium text-cyan-800 hover:bg-cyan-200 dark:bg-cyan-400/10 dark:text-cyan-200 dark:hover:bg-cyan-400/20"
                          >
                            Duplicate
                          </button>
                        </form>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">{formatDateTimeThai(cluster.latestAt)}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/80">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">รายการล่าสุด</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">แสดงสูงสุด {RECENT_LIMIT} รายการล่าสุดตามตัวกรอง</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">เวลา</th>
                <th className="px-3 py-2.5 text-left font-medium">คำค้น</th>
                <th className="px-3 py-2.5 text-right font-medium">ผลลัพธ์</th>
                <th className="px-3 py-2.5 text-left font-medium">แหล่งที่มา</th>
                <th className="px-3 py-2.5 text-left font-medium">ตัวกรอง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                    ไม่มีข้อมูลตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                logs.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">{formatDateTimeThai(item.createdAt)}</td>
                    <td className="max-w-[20rem] truncate px-3 py-2 font-medium text-gray-900 dark:text-slate-100">{item.query}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{item.resultCount.toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{getSourceLabel(item.source)}</td>
                    <td className="max-w-[28rem] truncate px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{getFilterLabel(item.filters)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
