export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronDown, Database, Info, Search, Store, Warehouse, Wand2 } from "lucide-react";

import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatCard from "@/components/shared/AdminStatCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import FormSubmitButton from "@/components/shared/FormSubmitButton";
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
import { VEHICLE_SYNONYM_CANDIDATE_ACTION } from "@/lib/chat-core/vehicle-synonym-staging";
import {
  applySearchSynonymCandidate,
  autoApplySearchSynonymCandidates,
  markProductSearchReviewOutcome,
  refreshProductSearchClusterCache,
} from "./actions";
import { FlashMessage } from "./FlashMessage";
import { ProductSearchReviewSheet } from "./ProductSearchReviewSheet";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const RECENT_LIMIT = 100;
const CLUSTER_LIMIT = 20;
const ANALYSIS_LIMIT = 500;
const PRODUCT_SELECT_LIMIT = 500;

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
    "vehicle-synonym": "AI เสนอชื่อรุ่นรถ",
  };
  return labels[action];
};

/** Pending AI vehicle-spelling suggestions shown at once. A backlog larger than
 *  this means the chat is hitting a systemic gap, not individual typos. */
const VEHICLE_SUGGESTION_LIMIT = 25;

const outcomeStatusOptions = ["all", "pending", "applied", "ignored", "needs-investigation", "duplicate"] as const;

type OutcomeStatusFilter = (typeof outcomeStatusOptions)[number];

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

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "pending" | "muted";

const getReviewStatusTone = (status?: PrismaProductSearchReviewStatus): BadgeTone => {
  const key = status ?? PrismaProductSearchReviewStatus.PENDING;
  const tones: Record<PrismaProductSearchReviewStatus, BadgeTone> = {
    PENDING: "neutral",
    APPLIED: "success",
    IGNORED: "muted",
    NEEDS_INVESTIGATION: "warning",
    DUPLICATE: "info",
  };
  return tones[key];
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

const getClosedLoopTone = (status: ProductSearchClosedLoopStatus): BadgeTone => {
  const tones: Record<ProductSearchClosedLoopStatus, BadgeTone> = {
    unmeasured: "neutral",
    improved: "success",
    unchanged: "warning",
    regressed: "danger",
  };
  return tones[status];
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
  const includeBots = params.includeBots === "1";
  const clusterPage = Math.max(1, parseInt(params.clusterPage ?? "1", 10) || 1);
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
    ...(includeBots ? {} : { isBot: false }),
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
    products,
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
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: PRODUCT_SELECT_LIMIT,
      select: { code: true, name: true },
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
  // AI-staged car-model spellings from the chat pipeline. They live in their own
  // candidateAction lane rather than attaching to a text-derived cluster, because
  // the suggestion comes from the LLM reading the customer's whole conversation —
  // which no analysis of the query STRING alone can reproduce. Always shown and
  // never date-filtered, so a pending suggestion cannot hide behind whatever window
  // the admin happens to be looking at.
  const pendingVehicleSuggestions = await db.productSearchReviewOutcome.findMany({
    where: { candidateAction: VEHICLE_SYNONYM_CANDIDATE_ACTION, status: "PENDING" },
    orderBy: { updatedAt: "desc" },
    take: VEHICLE_SUGGESTION_LIMIT,
    select: { normalizedQuery: true, note: true, appliedRef: true, updatedAt: true },
  });
  const filteredClusters = rawClusters
    .filter((cluster) => {
      if (outcomeStatus === "all") return true;
      const outcome = outcomeMap.get(`${cluster.normalizedQuery}\u0000${cluster.candidateAction}`);
      if (outcomeStatus === "pending") return !outcome || outcome.status === PrismaProductSearchReviewStatus.PENDING;
      return outcome ? prismaStatusToFilter[outcome.status] === outcomeStatus : false;
  });
  const clusterTotalCount = filteredClusters.length;
  const clusterPageCount = Math.max(1, Math.ceil(clusterTotalCount / CLUSTER_LIMIT));
  const clusterPageSafe = Math.min(clusterPage, clusterPageCount);
  const clusters = filteredClusters.slice(
    (clusterPageSafe - 1) * CLUSTER_LIMIT,
    clusterPageSafe * CLUSTER_LIMIT,
  );
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
    <div className="space-y-5">
      <AdminPageHeader
        title="Product Search Quality"
        description={`ติดตามคำค้นหาที่ไม่พบผลลัพธ์และคำค้นหาที่ได้ผลลัพธ์น้อยกว่า ${LOW_RESULT_SEARCH_THRESHOLD} รายการ เพื่อใช้ปรับ SearchSynonym, ProductAlias/OEM และ fitment`}
      />

      <FlashMessage f2Applied={f2Applied} f2Error={f2Error} />

      {/* ── How-to helper (collapsible) ── */}
      <details className="group overflow-hidden rounded-xl border border-sky-200 bg-sky-50/60 shadow-sm dark:border-sky-400/20 dark:bg-sky-400/5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-sky-50 dark:hover:bg-sky-400/10 sm:px-5">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-sky-600 dark:text-sky-300" />
            <span className="font-kanit text-sm font-semibold text-sky-950 dark:text-sky-100">วิธีใช้หน้านี้</span>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-sky-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-sky-100 px-4 py-4 text-sm text-slate-700 dark:border-sky-400/15 dark:text-slate-200 sm:px-5">
          <p>
            หน้านี้รวม <span className="font-medium">คำค้นที่ลูกค้า/แอดมินหาแล้วไม่เจอ (No-result) หรือเจอน้อยกว่า {LOW_RESULT_SEARCH_THRESHOLD} รายการ (Low-result)</span> เพื่อให้ไล่ปรับให้ค้นเจอ — bot ถูกซ่อนโดยค่าเริ่มต้น (ติ๊ก &ldquo;รวม bot&rdquo; เพื่อดู)
          </p>

          <div className="space-y-1.5">
            <p className="font-medium text-slate-900 dark:text-slate-100">ขั้นตอนใช้งาน</p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>กรองช่วงวันที่ + เลือกประเภท/แหล่งที่มา แล้วกด &ldquo;แสดงรายการ&rdquo;</li>
              <li>ไล่ดูตาราง <span className="font-medium">Top normalized query clusters</span> (เรียงตามจำนวนครั้งที่ค้น)</li>
              <li>ดูคอลัมน์ <span className="font-medium">Action</span> ที่ระบบแนะนำ แล้วกด <span className="font-medium">Review</span> เพื่อแก้หรือเปลี่ยนสถานะ</li>
              <li>สัปดาห์ถัดไปดู <span className="font-medium">Closed-loop = Improved</span> เพื่อยืนยันว่าที่แก้ได้ผล</li>
            </ol>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="font-medium text-slate-900 dark:text-slate-100">Action ที่ระบบแนะนำ</p>
              <ul className="space-y-1">
                <li><span className="font-medium">คำพ้อง (SearchSynonym)</span> — คำที่ลูกค้าเรียกต่างจากในระบบ</li>
                <li><span className="font-medium">ProductAlias/OEM</span> — รหัส/เบอร์อะไหล่ที่ยังไม่ผูกสินค้า</li>
                <li><span className="font-medium">รุ่นรถ (Fitment)</span> — รุ่น/ปีที่สินค้ายังไม่รองรับ</li>
                <li><span className="font-medium">noise</span> — คำขยะ ไม่ต้องแก้</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium text-slate-900 dark:text-slate-100">สถานะการรีวิว</p>
              <ul className="space-y-1">
                <li><span className="font-medium">Pending</span> — ยังไม่ได้รีวิว</li>
                <li><span className="font-medium">Applied</span> — แก้แล้ว (อัตโนมัติเมื่อกด Apply)</li>
                <li><span className="font-medium">Ignored</span> — เป็นขยะ ไม่ต้องแก้</li>
                <li><span className="font-medium">Needs investigation</span> — สำคัญแต่ต้องตรวจเพิ่ม</li>
                <li><span className="font-medium">Duplicate</span> — ซ้ำกับที่จัดการแล้ว</li>
              </ul>
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            * &ldquo;เปลี่ยนสถานะ&rdquo; ใน Review เป็นการติดป้ายการตัดสินใจ ไม่แตะข้อมูลสินค้า — ต่างจากปุ่ม Apply ที่เขียนข้อมูลจริง ทั้งหมดบันทึก audit log และเปลี่ยนทับได้
          </p>
        </div>
      </details>

      <AdminFilterToolbar className="mb-0">
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
        <label className="flex h-9 items-center gap-2 self-end rounded-md border border-input bg-background px-3 text-xs font-medium text-gray-600 dark:text-slate-300">
          <input type="checkbox" name="includeBots" value="1" defaultChecked={includeBots} className="h-4 w-4 accent-sky-600" />
          รวม bot
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
      </AdminFilterToolbar>

      {/* ── KPI group 1: Search overview ── */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 font-kanit text-sm font-semibold text-slate-600 dark:text-slate-300">
          <Search className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          ภาพรวมคำค้น
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <AdminStatCard label="รวมตามตัวกรอง" value={total.toLocaleString("th-TH")} />
          <AdminStatCard label="No-result" accent="danger" value={noResultTotal.toLocaleString("th-TH")} />
          <AdminStatCard label="Low-result" accent="warning" value={lowResultTotal.toLocaleString("th-TH")} />
          <AdminStatCard label="หน้าร้าน" accent="info" icon={<Store className="h-4 w-4" />} value={storefrontTotal.toLocaleString("th-TH")} />
          <AdminStatCard label="หลังบ้าน" icon={<Warehouse className="h-4 w-4" />} value={adminTotal.toLocaleString("th-TH")} />
        </div>
      </section>

      {/* ── KPI group 2: Review status ── */}
      <section className="space-y-2.5">
        <h2
          className="font-kanit text-sm font-semibold text-slate-600 dark:text-slate-300"
          title="ตัวเลขหลัก = review outcome ของ normalized query ที่อยู่ในช่วงตัวกรองด้านบน (Dep 2B); hint ด้านล่าง = review ที่ทำในช่วงเดียวกัน (Dep 2A)"
        >
          สถานะการรีวิว
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <AdminStatCard label="Pending" value={outcomeInRangePendingTotal.toLocaleString("th-TH")} hint={`Reviewed in range: ${outcomeReviewedPendingTotal.toLocaleString("th-TH")}`} />
          <AdminStatCard label="Applied" accent="success" value={outcomeInRangeAppliedTotal.toLocaleString("th-TH")} hint={`Reviewed in range: ${outcomeReviewedAppliedTotal.toLocaleString("th-TH")}`} />
          <AdminStatCard label="Ignored" value={outcomeInRangeIgnoredTotal.toLocaleString("th-TH")} hint={`Reviewed in range: ${outcomeReviewedIgnoredTotal.toLocaleString("th-TH")}`} />
          <AdminStatCard label="Needs investigation" accent="warning" value={outcomeInRangeNeedsInvestigationTotal.toLocaleString("th-TH")} hint={`Reviewed in range: ${outcomeReviewedNeedsInvestigationTotal.toLocaleString("th-TH")}`} />
          <AdminStatCard label="Duplicate" accent="info" value={outcomeInRangeDuplicateTotal.toLocaleString("th-TH")} hint={`Reviewed in range: ${outcomeReviewedDuplicateTotal.toLocaleString("th-TH")}`} />
        </div>
      </section>

      {/* ── KPI group 3: Closed-loop ── */}
      <section className="space-y-2.5">
        <h2 className="font-kanit text-sm font-semibold text-slate-600 dark:text-slate-300">
          Closed-loop (วัดผลหลัง Apply)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStatCard label="Improved" accent="success" value={closedLoopSummary.improved.toLocaleString("th-TH")} />
          <AdminStatCard label="Unchanged" accent="warning" value={closedLoopSummary.unchanged.toLocaleString("th-TH")} />
          <AdminStatCard label="Regressed" accent="danger" value={closedLoopSummary.regressed.toLocaleString("th-TH")} />
          <AdminStatCard label="Unmeasured" value={closedLoopSummary.unmeasured.toLocaleString("th-TH")} />
        </div>
      </section>

      <details
        open={autoApplyDryRun || undefined}
        className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/80"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Wand2 className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            <span className="font-kanit text-base font-semibold text-slate-950 dark:text-slate-50">Guarded Auto-Apply</span>
            <AdminStatusBadge tone={autoApplyEnabled ? "success" : "muted"}>
              {autoApplyEnabled ? "enabled" : "disabled"}
            </AdminStatusBadge>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-gray-100 px-4 py-4 dark:border-white/10 sm:px-5">
          <p className="max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            Dry-run เฉพาะ candidate แบบ SearchSynonym ที่เสี่ยงต่ำเท่านั้น: ไม่แตะ ProductAlias/OEM, fitment/year, query ที่มีตัวเลขหรือรูปแบบ code และไม่เขียนข้อมูลจนกว่าจะเปิดจากตั้งค่าร้านค้า
          </p>
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Admin setting: {autoApplyEnabled ? "enabled" : "disabled"} ({autoApplyEnabled ? "เขียนจริงได้หลัง dry-run" : "แสดง dry-run ได้เท่านั้น"})
          </p>
          <Link
            href={autoApplyDryRunUrl}
            className="inline-flex h-9 items-center justify-center rounded-md bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            Run dry-run
          </Link>

        {autoApplyDryRun ? (
          <div className="mt-1 space-y-3">
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
                <FormSubmitButton
                  disabled={!autoApplyEnabled}
                  className="h-8 rounded-md bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:disabled:bg-white/10 dark:disabled:text-slate-500"
                >
                  Auto-apply eligible
                </FormSubmitButton>
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
        </div>
      </details>

      <details className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/80">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Database className="h-4 w-4 text-violet-500 dark:text-violet-300" />
            <span className="font-kanit text-base font-semibold text-slate-950 dark:text-slate-50">Cluster cache (rolling windows)</span>
            <AdminStatusBadge tone={useCache ? "success" : cacheStaleButPresent ? "warning" : "muted"}>
              {useCache ? "ใช้ cache" : "live aggregation"}
            </AdminStatusBadge>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-4 dark:border-white/10 sm:px-5 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <p className="max-w-3xl text-xs text-slate-500 dark:text-slate-400">
              Cache cluster aggregation สำหรับช่วง {PRODUCT_SEARCH_CLUSTER_WINDOWS.map((w) => w.label).join(" / ")} — เมื่อตัวกรองวันที่ตรงกับช่วง cache ที่ fresh (&lt;1 ชม.) หน้านี้จะข้าม in-memory aggregation 500 แถวและอ่านจาก cache แทน ครอบคลุม cluster ทั้งหมด ไม่ใช่แค่ top 500
            </p>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
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
                <FormSubmitButton
                  className="h-9 rounded-md bg-violet-700 px-3 text-xs font-medium text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500"
                >
                  Refresh {window.label}
                </FormSubmitButton>
              </form>
            ))}
          </div>
        </div>
      </details>

      {pendingVehicleSuggestions.length > 0 ? (
        <AdminSectionCard
          title="AI เสนอชื่อรุ่นรถที่ลูกค้าพิมพ์ผิด (รออนุมัติ)"
          description="มาจากแชท LINE/Messenger — ระบบหารุ่นรถที่ลูกค้าพิมพ์ไม่เจอ แล้ว AI เดาว่าน่าจะหมายถึงรุ่นไหน โดยตรวจกับข้อมูลรุ่นรถจริงแล้วว่าตรงกับรุ่นเดียวเท่านั้น · กด &quot;อนุมัติ&quot; จะเพิ่มเป็นคำพ้อง (SearchSynonym) ให้ครั้งต่อไปค้นเจอเองโดยไม่ต้องใช้ AI"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#1e3a5f] text-white dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">ลูกค้าพิมพ์ว่า</th>
                  <th className="px-3 py-2.5 text-left font-medium">AI เสนอว่าคือรุ่น</th>
                  <th className="px-3 py-2.5 text-left font-medium">ล่าสุด</th>
                  <th className="px-3 py-2.5 text-left font-medium">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {pendingVehicleSuggestions.map((suggestion) => (
                  <tr
                    key={suggestion.normalizedQuery}
                    className="hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-100">
                      {suggestion.normalizedQuery}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-sky-800 dark:text-sky-300">
                        {suggestion.appliedRef ?? "-"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">
                      {formatDateTimeThai(suggestion.updatedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Approve → writes the SearchSynonym row through the SAME
                            action the storefront review flow uses, and flips this
                            outcome to APPLIED so it leaves the queue. */}
                        <form action={applySearchSynonymCandidate} className="inline">
                          <input type="hidden" name="term" value={suggestion.appliedRef ?? ""} />
                          <input type="hidden" name="candidate" value={suggestion.normalizedQuery} />
                          <input
                            type="hidden"
                            name="normalizedQuery"
                            value={suggestion.normalizedQuery}
                          />
                          <input
                            type="hidden"
                            name="candidateAction"
                            value={VEHICLE_SYNONYM_CANDIDATE_ACTION}
                          />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <FormSubmitButton
                            className="h-8 rounded-md bg-[#1e3a5f] px-3 text-xs font-medium text-white hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-700 dark:hover:bg-sky-600"
                            disabled={!suggestion.appliedRef}
                          >
                            อนุมัติ
                          </FormSubmitButton>
                        </form>
                        <form action={markProductSearchReviewOutcome} className="inline">
                          <input
                            type="hidden"
                            name="normalizedQuery"
                            value={suggestion.normalizedQuery}
                          />
                          <input
                            type="hidden"
                            name="candidateAction"
                            value={VEHICLE_SYNONYM_CANDIDATE_ACTION}
                          />
                          <input type="hidden" name="status" value="ignored" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <FormSubmitButton className="h-8 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">
                            ไม่ใช่
                          </FormSubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminSectionCard>
      ) : null}

      <AdminSectionCard
        title="Top normalized query clusters"
        description={`รวม query ที่สะกด/เว้นวรรค/เครื่องหมายต่างกันให้อยู่กลุ่มเดียวกัน แสดงสูงสุด ${CLUSTER_LIMIT} กลุ่ม${useCache ? ` จาก cache "${matchedWindow?.label ?? ""}" (${cachedRows.length} clusters ทั้งหมด)` : `จากรายการล่าสุด ${ANALYSIS_LIMIT} รายการ (live aggregation)`}`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#1e3a5f] text-white dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Normalized query</th>
                <th className="px-3 py-2.5 text-left font-medium">Raw variants</th>
                <th className="px-3 py-2.5 text-right font-medium">ครั้ง</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg result</th>
                <th className="px-3 py-2.5 text-left font-medium">ประเภท</th>
                <th className="px-3 py-2.5 text-left font-medium">Action</th>
                <th className="px-3 py-2.5 text-left font-medium">Review</th>
                <th className="px-3 py-2.5 text-left font-medium">ล่าสุด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {clusters.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
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
                        <AdminStatusBadge tone={getReviewStatusTone(outcome?.status)}>
                          {getReviewStatusLabel(outcome?.status)}
                        </AdminStatusBadge>
                        {outcome?.note ? (
                          <p className="line-clamp-2 text-xs text-gray-500 dark:text-slate-400">{outcome.note}</p>
                        ) : null}
                        {closedLoop ? (
                          <div className="space-y-1">
                            <AdminStatusBadge tone={getClosedLoopTone(closedLoop.status)}>
                              {getClosedLoopLabel(closedLoop.status)}
                            </AdminStatusBadge>
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
                      <AdminStatusBadge tone={cluster.bucket === "no-result" ? "danger" : "warning"}>
                        {getBucketLabel(cluster.bucket)}
                      </AdminStatusBadge>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-200">
                      <AdminStatusBadge tone="info">
                        {getActionLabel(cluster.candidateAction)}
                      </AdminStatusBadge>
                    </td>
                    <td className="px-3 py-2">
                      <ProductSearchReviewSheet
                        cluster={{
                          normalizedQuery: cluster.normalizedQuery,
                          rawQueries: cluster.rawQueries,
                          candidateAction: cluster.candidateAction as "search-synonym" | "product-alias-oem" | "fitment-year" | "review-noise",
                        }}
                        outcome={
                          outcome
                            ? { status: outcome.status, note: outcome.note ?? null, suggestedTerm: null }
                            : null
                        }
                        products={products}
                        carBrands={carBrands}
                        fitmentYearHint={fitmentYearHint}
                        returnTo={returnTo}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">{formatDateTimeThai(cluster.latestAt)}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* ── Pagination (Item 18) ── */}
        {clusterPageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-white/10">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              แสดง {((clusterPageSafe - 1) * CLUSTER_LIMIT) + 1}–{Math.min(clusterPageSafe * CLUSTER_LIMIT, clusterTotalCount)} จาก {clusterTotalCount} กลุ่ม
            </p>
            <div className="flex items-center gap-2">
              {clusterPageSafe > 1 ? (
                <Link
                  href={(() => {
                    const next = new URLSearchParams(returnParams);
                    next.set("clusterPage", String(clusterPageSafe - 1));
                    return `/admin/reports/product-search-no-result?${next}`;
                  })()}
                  className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  ← ก่อนหน้า
                </Link>
              ) : null}
              <span className="text-xs text-gray-500 dark:text-slate-400">
                หน้า {clusterPageSafe} / {clusterPageCount}
              </span>
              {clusterPageSafe < clusterPageCount ? (
                <Link
                  href={(() => {
                    const next = new URLSearchParams(returnParams);
                    next.set("clusterPage", String(clusterPageSafe + 1));
                    return `/admin/reports/product-search-no-result?${next}`;
                  })()}
                  className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  ถัดไป →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </AdminSectionCard>

      <AdminSectionCard
        title="รายการล่าสุด"
        description={`แสดงสูงสุด ${RECENT_LIMIT} รายการล่าสุดตามตัวกรอง`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#1e3a5f] text-white dark:bg-slate-800">
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
      </AdminSectionCard>
    </div>
  );
}
