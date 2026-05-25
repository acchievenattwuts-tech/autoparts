"use server";

import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import {
  AliasKind,
  AuditAction,
  Prisma,
  ProductSearchReviewStatus as PrismaProductSearchReviewStatus,
} from "@/lib/generated/prisma";
import { mergeSearchSynonymCandidate } from "@/lib/product-search-candidate-apply";
import {
  buildAutoApplySearchSynonymPlan,
  type ProductSearchAutoApplySynonym,
} from "@/lib/product-search-auto-apply";
import {
  findProductSearchQualityMetrics,
  type ProductSearchQualityMetrics,
} from "@/lib/product-search-closed-loop";
import {
  buildProductSearchReviewOutcomeKey,
  isProductSearchReviewStatus,
  type ProductSearchReviewStatus,
} from "@/lib/product-search-review-outcome";
import { validateFitmentYearRange } from "@/lib/product-search-fitment-remediation";
import { requirePermission } from "@/lib/require-auth";
import { SEARCH_SYNONYM_CACHE_TAG } from "@/lib/search-synonyms";
import { getSiteConfig } from "@/lib/site-config";
import { LOW_RESULT_SEARCH_THRESHOLD } from "@/lib/product-search-telemetry";
import {
  PRODUCT_SEARCH_CLUSTER_WINDOWS,
  buildClusterCacheRows,
  getRollingWindowRange,
  type ProductSearchClusterWindowKey,
} from "@/lib/product-search-cluster-cache";
import { revalidateStorefrontCaches } from "@/lib/storefront-revalidation";

const REPORT_PATH = "/admin/reports/product-search-no-result";
const SEARCH_SYNONYM_ADMIN_PATH = "/admin/master/search-synonyms";
const PRODUCT_ADMIN_PATH = "/admin/products";

const returnToSchema = z.string().max(500).optional();

const searchSynonymCandidateSchema = z.object({
  term: z.string().trim().min(1).max(100),
  candidate: z.string().trim().min(1).max(100),
  normalizedQuery: z.string().trim().min(1).max(200),
  candidateAction: z.string().trim().min(1).max(50),
  language: z.string().trim().max(10).optional().or(z.literal("")),
  returnTo: returnToSchema,
});

const productAliasCandidateSchema = z.object({
  productCode: z.string().trim().min(1).max(50),
  alias: z.string().trim().min(1).max(100),
  normalizedQuery: z.string().trim().min(1).max(200),
  candidateAction: z.string().trim().min(1).max(50),
  kind: z.nativeEnum(AliasKind),
  returnTo: returnToSchema,
});

const optionalTextSchema = z.string().trim().max(100).optional().or(z.literal(""));
const optionalYearSchema = z
  .preprocess((value) => (value === "" || value === null || value === undefined ? null : Number(value)), z.number().int().min(1900).max(2200).nullable())
  .optional();

const productFitmentCandidateSchema = z.object({
  productCode: z.string().trim().min(1).max(50),
  carModelId: z.string().trim().min(1).max(50),
  normalizedQuery: z.string().trim().min(1).max(200),
  candidateAction: z.string().trim().min(1).max(50),
  submodel: optionalTextSchema,
  yearStart: optionalYearSchema,
  yearEnd: optionalYearSchema,
  engineCode: optionalTextSchema,
  engineSize: optionalTextSchema,
  note: z.string().trim().max(200).optional().or(z.literal("")),
  returnTo: returnToSchema,
});

const reviewOutcomeSchema = z.object({
  normalizedQuery: z.string().trim().min(1).max(200),
  candidateAction: z.string().trim().min(1).max(50),
  status: z.string().trim().min(1).max(30),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  returnTo: returnToSchema,
});

const autoApplyCandidateSchema = z.object({
  normalizedQuery: z.string().trim().min(1).max(200),
  rawQueries: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
});

const autoApplySearchSynonymSchema = z.object({
  candidates: z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid candidates JSON" });
        return z.NEVER;
      }
    })
    .pipe(z.array(autoApplyCandidateSchema).min(1).max(20)),
  returnTo: returnToSchema,
});

const REVIEW_STATUS_TO_PRISMA: Record<ProductSearchReviewStatus, PrismaProductSearchReviewStatus> = {
  pending: PrismaProductSearchReviewStatus.PENDING,
  applied: PrismaProductSearchReviewStatus.APPLIED,
  ignored: PrismaProductSearchReviewStatus.IGNORED,
  "needs-investigation": PrismaProductSearchReviewStatus.NEEDS_INVESTIGATION,
  duplicate: PrismaProductSearchReviewStatus.DUPLICATE,
};

const sanitizeReturnTo = (value: string | undefined): string => {
  if (!value) return REPORT_PATH;
  if (value === REPORT_PATH) return value;
  // Only allow same-path with query string. Prevents prefix-based open redirect
  // such as `/admin/reports/product-search-no-result-evil` or `//host`.
  if (value.startsWith(`${REPORT_PATH}?`)) return value;
  return REPORT_PATH;
};

const redirectWithStatus = (returnTo: string | undefined, key: "f2Applied" | "f2Error", value: string): never => {
  const base = new URL(sanitizeReturnTo(returnTo), "https://admin.local");
  base.searchParams.delete("f2Applied");
  base.searchParams.delete("f2Error");
  base.searchParams.set(key, value);
  redirect(`${base.pathname}${base.search}`);
};

const refreshSearchSynonymCaches = () => {
  updateTag(SEARCH_SYNONYM_CACHE_TAG);
  updateTag("product-search");
  revalidatePath(REPORT_PATH);
  revalidatePath(SEARCH_SYNONYM_ADMIN_PATH);
};

async function getSearchSynonymSnapshot(id: string) {
  return db.searchSynonym.findUnique({
    where: { id },
    select: {
      id: true,
      term: true,
      synonyms: true,
      language: true,
      isActive: true,
    },
  });
}

async function getReviewOutcomeSnapshot(normalizedQuery: string, candidateAction: string) {
  return db.productSearchReviewOutcome.findUnique({
    where: {
      normalizedQuery_candidateAction: {
        normalizedQuery,
        candidateAction,
      },
    },
  });
}

async function getBaselineMetricsSnapshot(normalizedQuery: string, reviewedAt: Date) {
  const logs = await db.productSearchLog.findMany({
    where: {
      resultCount: { lte: LOW_RESULT_SEARCH_THRESHOLD },
      createdAt: { lte: reviewedAt },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { query: true, resultCount: true, source: true, createdAt: true, hitCount: true },
  });

  return findProductSearchQualityMetrics(logs, normalizedQuery);
}

async function upsertReviewOutcome({
  normalizedQuery,
  candidateAction,
  status,
  note,
  appliedType,
  appliedRef,
  session,
  requestContext,
}: {
  normalizedQuery: string;
  candidateAction: string;
  status: ProductSearchReviewStatus;
  note?: string | null;
  appliedType?: string | null;
  appliedRef?: string | null;
  session: Awaited<ReturnType<typeof requirePermission>>;
  requestContext: Awaited<ReturnType<typeof getRequestContext>>;
}) {
  const key = buildProductSearchReviewOutcomeKey({ normalizedQuery, candidateAction });
  const beforeSnapshot = await getReviewOutcomeSnapshot(key.normalizedQuery, key.candidateAction);
  const reviewedAt = new Date();
  const reviewedByName = session.user?.name ?? session.user?.email ?? null;
  const baseline = beforeSnapshot?.baselineCount
    ? null
    : await getBaselineMetricsSnapshot(key.normalizedQuery, reviewedAt);

  const outcome = await db.productSearchReviewOutcome.upsert({
    where: {
      normalizedQuery_candidateAction: {
        normalizedQuery: key.normalizedQuery,
        candidateAction: key.candidateAction,
      },
    },
    create: {
      normalizedQuery: key.normalizedQuery,
      candidateAction: key.candidateAction,
      status: REVIEW_STATUS_TO_PRISMA[status],
      note: note || null,
      appliedType: appliedType || null,
      appliedRef: appliedRef || null,
      baselineCount: baseline?.count ?? null,
      baselineAvg: baseline?.avgResultCount ?? null,
      baselineLatestAt: baseline?.latestAt ?? null,
      baselineSources: baseline?.sourceCounts ?? Prisma.JsonNull,
      reviewedById: session.user?.id ?? null,
      reviewedByName,
      reviewedAt,
    },
    update: {
      status: REVIEW_STATUS_TO_PRISMA[status],
      note: note || null,
      appliedType: appliedType || null,
      appliedRef: appliedRef || null,
      ...(baseline
        ? {
            baselineCount: baseline.count,
            baselineAvg: baseline.avgResultCount,
            baselineLatestAt: baseline.latestAt,
            baselineSources: baseline.sourceCounts,
          }
        : {}),
      reviewedById: session.user?.id ?? null,
      reviewedByName,
      reviewedAt,
    },
  });

  const afterSnapshot = await getReviewOutcomeSnapshot(key.normalizedQuery, key.candidateAction);
  if (afterSnapshot) {
    if (!beforeSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "ProductSearchReviewOutcome",
        entityId: afterSnapshot.id,
        entityRef: `${afterSnapshot.normalizedQuery} / ${afterSnapshot.candidateAction}`,
        after: afterSnapshot,
      });
    } else {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "ProductSearchReviewOutcome",
        entityId: afterSnapshot.id,
        entityRef: `${afterSnapshot.normalizedQuery} / ${afterSnapshot.candidateAction}`,
        before: diff.before,
        after: diff.after,
      });
    }
  }

  revalidatePath(REPORT_PATH);
  return outcome;
}

export async function markProductSearchReviewOutcome(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = reviewOutcomeSchema.safeParse(raw);
  if (!parsed.success) {
    return redirectWithStatus(String(raw.returnTo ?? ""), "f2Error", "Invalid review outcome");
  }

  const session = await requirePermission("product_search_report.view").catch(() => null);
  if (!session?.user?.id) {
    return redirectWithStatus(parsed.data.returnTo, "f2Error", "Missing product search report permission");
  }

  const { normalizedQuery, candidateAction, status, note, returnTo } = parsed.data;
  if (!isProductSearchReviewStatus(status) || status === "applied") {
    return redirectWithStatus(returnTo, "f2Error", "Invalid review status");
  }

  const requestContext = await getRequestContext();
  await upsertReviewOutcome({
    normalizedQuery,
    candidateAction,
    status,
    note: note || null,
    session,
    requestContext,
  });

  redirectWithStatus(returnTo, "f2Applied", "Review outcome updated");
}

export async function applySearchSynonymCandidate(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = searchSynonymCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return redirectWithStatus(String(raw.returnTo ?? ""), "f2Error", "Invalid SearchSynonym candidate");
  }
  const data = parsed.data;

  const session = await requirePermission("search_synonyms.update").catch(() => null);
  if (!session?.user?.id) {
    return redirectWithStatus(data.returnTo, "f2Error", "Missing SearchSynonym permission");
  }

  const { term, candidate, normalizedQuery, candidateAction, language, returnTo } = data;

  try {
    const requestContext = await getRequestContext();
    const existing = await db.searchSynonym.findUnique({ where: { term } });

    if (existing) {
      const beforeSnapshot = await getSearchSynonymSnapshot(existing.id);
      const merged = mergeSearchSynonymCandidate(existing.synonyms, term, candidate);

      if (!merged.success) {
        return redirectWithStatus(returnTo, "f2Error", "SearchSynonym list is full");
      }

      if (merged.changed || !existing.isActive || (language && language !== existing.language)) {
        await db.searchSynonym.update({
          where: { id: existing.id },
          data: {
            synonyms: merged.synonyms,
            isActive: true,
            ...(language ? { language } : {}),
          },
        });

        const afterSnapshot = await getSearchSynonymSnapshot(existing.id);
        if (beforeSnapshot && afterSnapshot) {
          const diff = diffEntity(beforeSnapshot, afterSnapshot);
          await safeWriteAuditLog({
            ...getAuditActorFromSession(session),
            ...requestContext,
            action: AuditAction.UPDATE,
            entityType: "SearchSynonym",
            entityId: afterSnapshot.id,
            entityRef: afterSnapshot.term,
            before: diff.before,
            after: diff.after,
            meta: { appliedFrom: "product-search-quality-report", candidate },
          });
        }
      }

      await upsertReviewOutcome({
        normalizedQuery,
        candidateAction,
        status: "applied",
        appliedType: "SearchSynonym",
        appliedRef: existing.id,
        session,
        requestContext,
      });
      refreshSearchSynonymCaches();
      redirectWithStatus(returnTo, "f2Applied", "SearchSynonym updated");
      return;
    }

    const merged = mergeSearchSynonymCandidate([], term, candidate);
    if (!merged.success) {
      return redirectWithStatus(returnTo, "f2Error", "SearchSynonym list is full");
    }

    const created = await db.searchSynonym.create({
      data: {
        term,
        synonyms: merged.synonyms,
        language: language || null,
        isActive: true,
      },
    });
    const snapshot = await getSearchSynonymSnapshot(created.id);
    if (snapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "SearchSynonym",
        entityId: snapshot.id,
        entityRef: snapshot.term,
        after: snapshot,
        meta: { appliedFrom: "product-search-quality-report", candidate },
      });
    }

    await upsertReviewOutcome({
      normalizedQuery,
      candidateAction,
      status: "applied",
      appliedType: "SearchSynonym",
      appliedRef: created.id,
      session,
      requestContext,
    });
    refreshSearchSynonymCaches();
    redirectWithStatus(returnTo, "f2Applied", "SearchSynonym created");
    return;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirectWithStatus(returnTo, "f2Error", "SearchSynonym already exists");
      return;
    }

    throw error;
  }
}

export async function autoApplySearchSynonymCandidates(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = autoApplySearchSynonymSchema.safeParse(raw);
  if (!parsed.success) {
    return redirectWithStatus(String(raw.returnTo ?? ""), "f2Error", "Invalid auto-apply candidates");
  }

  const { candidates, returnTo } = parsed.data;
  const autoApplyEnabled = await getSiteConfig()
    .then((config) => config.productSearchAutoApplySynonymsEnabled)
    .catch(() => false);
  if (!autoApplyEnabled) {
    return redirectWithStatus(returnTo, "f2Error", "SearchSynonym auto-apply setting is disabled");
  }

  const session = await requirePermission("search_synonyms.update").catch(() => null);
  if (!session?.user?.id) {
    return redirectWithStatus(returnTo, "f2Error", "Missing SearchSynonym permission");
  }

  const existingSynonyms = await db.searchSynonym.findMany({
    select: { id: true, term: true, synonyms: true, language: true, isActive: true },
  });
  const outcomeKeys = candidates.map((candidate) => ({
    normalizedQuery: candidate.normalizedQuery,
    candidateAction: "search-synonym",
  }));
  const outcomes = await db.productSearchReviewOutcome.findMany({
    where: { OR: outcomeKeys },
    select: { normalizedQuery: true, candidateAction: true, status: true },
  });
  const outcomeByKey = new Map(
    outcomes.map((outcome) => [
      `${outcome.normalizedQuery}\u0000${outcome.candidateAction}`,
      { status: outcome.status },
    ]),
  );
  const clusters = candidates.map((candidate) => ({
    normalizedQuery: candidate.normalizedQuery,
    rawQueries: candidate.rawQueries,
    count: candidate.rawQueries.length,
    latestAt: new Date(),
    minResultCount: 0,
    avgResultCount: 0,
    sourceCounts: {},
    bucket: "no-result" as const,
    candidateAction: "search-synonym" as const,
  }));
  const plan = buildAutoApplySearchSynonymPlan({
    clusters,
    existingSynonyms: existingSynonyms as ProductSearchAutoApplySynonym[],
    outcomeByKey,
  });
  const eligibleItems = plan.filter((item) => item.eligible);
  if (eligibleItems.length === 0) {
    return redirectWithStatus(returnTo, "f2Error", "No eligible SearchSynonym candidates to auto-apply");
  }

  // Pre-validation phase: simulate all merges in memory using already-loaded
  // existingSynonyms. Avoids N+1 findUnique queries and guarantees fail-fast —
  // if any candidate would overflow the synonym list we abort BEFORE any DB
  // write, so prior items can never be left half-committed.
  const existingById = new Map<string, ProductSearchAutoApplySynonym>();
  const existingByTerm = new Map<string, ProductSearchAutoApplySynonym>();
  for (const synonym of existingSynonyms as ProductSearchAutoApplySynonym[]) {
    existingById.set(synonym.id, synonym);
    existingByTerm.set(synonym.term, synonym);
  }

  type ValidatedItem = {
    item: (typeof eligibleItems)[number];
    existing: ProductSearchAutoApplySynonym | null;
    nextSynonyms: string[];
    changed: boolean;
  };

  const validatedPlan: ValidatedItem[] = [];
  for (const item of eligibleItems) {
    const existing =
      (item.existingSynonymId ? existingById.get(item.existingSynonymId) : null) ??
      existingByTerm.get(item.term) ??
      null;

    let nextSynonyms = existing?.synonyms ?? [];
    let changed = false;
    for (const synonym of item.synonymsToAdd) {
      const merged = mergeSearchSynonymCandidate(nextSynonyms, item.term, synonym);
      if (!merged.success) {
        return redirectWithStatus(returnTo, "f2Error", `SearchSynonym list is full for "${item.term}"`);
      }
      changed = changed || merged.changed;
      nextSynonyms = merged.synonyms;
    }
    validatedPlan.push({ item, existing, nextSynonyms, changed });
  }

  // Pre-fetch outcome before-snapshots and baselines OUTSIDE the transaction.
  // Baseline computation reads up to 1000 rows from ProductSearchLog and must
  // not run inside the tx (would exhaust the tx timeout under load).
  const reviewedAt = new Date();
  const outcomeBeforeMap = new Map<string, Awaited<ReturnType<typeof getReviewOutcomeSnapshot>>>();
  const baselineByKey = new Map<string, ProductSearchQualityMetrics | null>();
  for (const { item } of validatedPlan) {
    const key = `${item.normalizedQuery} search-synonym`;
    const outcome = await getReviewOutcomeSnapshot(item.normalizedQuery, "search-synonym");
    outcomeBeforeMap.set(key, outcome);
    if (!outcome?.baselineCount) {
      const baseline = await getBaselineMetricsSnapshot(item.normalizedQuery, reviewedAt);
      baselineByKey.set(key, baseline);
    }
  }

  type SynonymSnapshot = NonNullable<Awaited<ReturnType<typeof getSearchSynonymSnapshot>>>;
  type OutcomeSnapshot = NonNullable<Awaited<ReturnType<typeof getReviewOutcomeSnapshot>>>;
  type SynonymAuditEntry =
    | { kind: "synonym-create"; after: SynonymSnapshot; synonymsToAdd: string[] }
    | { kind: "synonym-update"; before: SynonymSnapshot; after: SynonymSnapshot; synonymsToAdd: string[] };
  type OutcomeAuditEntry =
    | { kind: "outcome-create"; after: OutcomeSnapshot }
    | { kind: "outcome-update"; before: OutcomeSnapshot; after: OutcomeSnapshot };

  const synonymAuditEntries: SynonymAuditEntry[] = [];
  const outcomeAuditEntries: OutcomeAuditEntry[] = [];
  const reviewedByName = session.user?.name ?? session.user?.email ?? null;
  const reviewerId = session.user?.id ?? null;

  // Atomic write phase: every SearchSynonym + ProductSearchReviewOutcome write
  // commits together. If any single write fails the entire batch rolls back so
  // no half-applied state can leak (covers DB-level errors that pre-validation
  // cannot catch, e.g. lock conflicts or network blips).
  await db.$transaction(
    async (tx) => {
      for (const { item, existing, nextSynonyms, changed } of validatedPlan) {
        const key = `${item.normalizedQuery} search-synonym`;
        const rollbackNote = `Auto-applied from Product Search Quality dry-run. Rollback: open SearchSynonym and remove added synonyms (${item.synonymsToAdd.join(", ")}) or deactivate the synonym row.`;

        let synonymId: string;
        if (existing) {
          synonymId = existing.id;
          if (changed || !existing.isActive) {
            await tx.searchSynonym.update({
              where: { id: existing.id },
              data: { synonyms: nextSynonyms, isActive: true },
            });

            const after = await tx.searchSynonym.findUnique({
              where: { id: existing.id },
              select: { id: true, term: true, synonyms: true, language: true, isActive: true },
            });
            if (after) {
              synonymAuditEntries.push({
                kind: "synonym-update",
                before: {
                  id: existing.id,
                  term: existing.term,
                  synonyms: existing.synonyms,
                  language: existing.language,
                  isActive: existing.isActive,
                },
                after,
                synonymsToAdd: item.synonymsToAdd,
              });
            }
          }
        } else {
          const created = await tx.searchSynonym.create({
            data: {
              term: item.term,
              synonyms: item.synonymsToAdd,
              language: item.language,
              isActive: true,
            },
          });
          synonymId = created.id;
          const after = await tx.searchSynonym.findUnique({
            where: { id: created.id },
            select: { id: true, term: true, synonyms: true, language: true, isActive: true },
          });
          if (after) {
            synonymAuditEntries.push({
              kind: "synonym-create",
              after,
              synonymsToAdd: item.synonymsToAdd,
            });
          }
        }

        const outcomeBefore = outcomeBeforeMap.get(key) ?? null;
        const baseline = baselineByKey.get(key) ?? null;
        const outcomeAfter = await tx.productSearchReviewOutcome.upsert({
          where: {
            normalizedQuery_candidateAction: {
              normalizedQuery: item.normalizedQuery,
              candidateAction: "search-synonym",
            },
          },
          create: {
            normalizedQuery: item.normalizedQuery,
            candidateAction: "search-synonym",
            status: REVIEW_STATUS_TO_PRISMA.applied,
            note: rollbackNote,
            appliedType: "SearchSynonymAutoApply",
            appliedRef: synonymId,
            baselineCount: baseline?.count ?? null,
            baselineAvg: baseline?.avgResultCount ?? null,
            baselineLatestAt: baseline?.latestAt ?? null,
            baselineSources: baseline?.sourceCounts ?? Prisma.JsonNull,
            reviewedById: reviewerId,
            reviewedByName,
            reviewedAt,
          },
          update: {
            status: REVIEW_STATUS_TO_PRISMA.applied,
            note: rollbackNote,
            appliedType: "SearchSynonymAutoApply",
            appliedRef: synonymId,
            ...(baseline
              ? {
                  baselineCount: baseline.count,
                  baselineAvg: baseline.avgResultCount,
                  baselineLatestAt: baseline.latestAt,
                  baselineSources: baseline.sourceCounts,
                }
              : {}),
            reviewedById: reviewerId,
            reviewedByName,
            reviewedAt,
          },
        });

        if (outcomeBefore) {
          outcomeAuditEntries.push({ kind: "outcome-update", before: outcomeBefore, after: outcomeAfter });
        } else {
          outcomeAuditEntries.push({ kind: "outcome-create", after: outcomeAfter });
        }
      }
    },
    { timeout: 30000 },
  );

  // Post-commit side effects: audit log + cache invalidation must run after the
  // transaction commits so they reflect the actual persisted state.
  const requestContext = await getRequestContext();
  for (const entry of synonymAuditEntries) {
    if (entry.kind === "synonym-create") {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "SearchSynonym",
        entityId: entry.after.id,
        entityRef: entry.after.term,
        after: entry.after,
        meta: { appliedFrom: "product-search-quality-auto-apply", synonymsToAdd: entry.synonymsToAdd },
      });
    } else {
      const diff = diffEntity(entry.before, entry.after);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "SearchSynonym",
        entityId: entry.after.id,
        entityRef: entry.after.term,
        before: diff.before,
        after: diff.after,
        meta: { appliedFrom: "product-search-quality-auto-apply", synonymsToAdd: entry.synonymsToAdd },
      });
    }
  }
  for (const entry of outcomeAuditEntries) {
    if (entry.kind === "outcome-create") {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "ProductSearchReviewOutcome",
        entityId: entry.after.id,
        entityRef: `${entry.after.normalizedQuery} / ${entry.after.candidateAction}`,
        after: entry.after,
      });
    } else {
      const diff = diffEntity(entry.before, entry.after);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "ProductSearchReviewOutcome",
        entityId: entry.after.id,
        entityRef: `${entry.after.normalizedQuery} / ${entry.after.candidateAction}`,
        before: diff.before,
        after: diff.after,
      });
    }
  }

  refreshSearchSynonymCaches();
  const appliedCount = validatedPlan.length;
  redirectWithStatus(returnTo, "f2Applied", `Auto-applied ${appliedCount} SearchSynonym candidate(s)`);
}

export async function applyProductAliasCandidate(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = productAliasCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return redirectWithStatus(String(raw.returnTo ?? ""), "f2Error", "Invalid ProductAlias candidate");
  }
  const data = parsed.data;

  const session = await requirePermission("products.update").catch(() => null);
  if (!session?.user?.id) {
    return redirectWithStatus(data.returnTo, "f2Error", "Missing product update permission");
  }

  const { productCode, alias, normalizedQuery, candidateAction, kind, returnTo } = data;

  const product = await db.product.findFirst({
    where: { code: { equals: productCode, mode: "insensitive" } },
    select: { id: true, code: true },
  });

  if (!product) {
    return redirectWithStatus(returnTo, "f2Error", "Product code not found");
  }

  try {
    const requestContext = await getRequestContext();

    const productAlias = await db.productAlias.create({
      data: {
        productId: product.id,
        alias,
        kind,
      },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "ProductAlias",
      entityId: productAlias.id,
      entityRef: `${product.code} / ${alias}`,
      after: { productId: product.id, productCode: product.code, alias, kind },
      meta: { appliedFrom: "product-search-quality-report" },
    });

    await upsertReviewOutcome({
      normalizedQuery,
      candidateAction,
      status: "applied",
      appliedType: "ProductAlias",
      appliedRef: productAlias.id,
      session,
      requestContext,
    });
    updateTag("product-search");
    revalidatePath(REPORT_PATH);
    revalidatePath(PRODUCT_ADMIN_PATH);
    revalidatePath(`${PRODUCT_ADMIN_PATH}/${product.id}/edit`);
    await revalidateStorefrontCaches();
    redirectWithStatus(returnTo, "f2Applied", "ProductAlias added");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirectWithStatus(returnTo, "f2Error", "ProductAlias มีอยู่แล้ว ไม่ได้สร้างใหม่");
      return;
    }

    throw error;
  }
}

export async function applyProductFitmentCandidate(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = productFitmentCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return redirectWithStatus(String(raw.returnTo ?? ""), "f2Error", "Invalid ProductFitment candidate");
  }
  const data = parsed.data;

  const session = await requirePermission("products.update").catch(() => null);
  if (!session?.user?.id) {
    return redirectWithStatus(data.returnTo, "f2Error", "Missing product update permission");
  }

  const {
    productCode,
    carModelId,
    normalizedQuery,
    candidateAction,
    returnTo,
  } = data;
  const submodel = data.submodel || null;
  const engineCode = data.engineCode || null;
  const engineSize = data.engineSize || null;
  const note = data.note || null;
  const yearStart = data.yearStart ?? null;
  const yearEnd = data.yearEnd ?? null;

  const yearValidation = validateFitmentYearRange(yearStart, yearEnd);
  if (!yearValidation.success) {
    return redirectWithStatus(returnTo, "f2Error", yearValidation.error);
  }

  const [product, carModel] = await Promise.all([
    db.product.findFirst({
      where: { code: { equals: productCode, mode: "insensitive" } },
      select: { id: true, code: true },
    }),
    db.carModel.findFirst({
      where: { id: carModelId, isActive: true },
      select: { id: true },
    }),
  ]);

  if (!product) {
    return redirectWithStatus(returnTo, "f2Error", "Product code not found");
  }
  if (!carModel) {
    return redirectWithStatus(returnTo, "f2Error", "Car model not found");
  }

  const requestContext = await getRequestContext();
  const existing = await db.productFitment.findFirst({
    where: {
      productId: product.id,
      carModelId,
      submodel,
      yearStart,
      yearEnd,
      engineCode,
    },
    select: { id: true },
  });

  if (existing) {
    await upsertReviewOutcome({
      normalizedQuery,
      candidateAction,
      status: "applied",
      appliedType: "ProductFitment",
      appliedRef: existing.id,
      note: "ProductFitment already exists",
      session,
      requestContext,
    });
    return redirectWithStatus(returnTo, "f2Error", "ProductFitment มีอยู่แล้ว ไม่ได้สร้างใหม่");
  }

  try {
    const productFitment = await db.productFitment.create({
      data: {
        productId: product.id,
        carModelId,
        submodel,
        yearStart,
        yearEnd,
        engineCode,
        engineSize,
        note,
      },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "ProductFitment",
      entityId: productFitment.id,
      entityRef: `${product.code} / ${carModelId}`,
      after: {
        productId: product.id,
        productCode: product.code,
        carModelId,
        submodel,
        yearStart,
        yearEnd,
        engineCode,
        engineSize,
        note,
      },
      meta: { appliedFrom: "product-search-quality-report" },
    });

    await upsertReviewOutcome({
      normalizedQuery,
      candidateAction,
      status: "applied",
      appliedType: "ProductFitment",
      appliedRef: productFitment.id,
      session,
      requestContext,
    });

    updateTag("product-search");
    revalidatePath(REPORT_PATH);
    revalidatePath(PRODUCT_ADMIN_PATH);
    revalidatePath(`${PRODUCT_ADMIN_PATH}/${product.id}/edit`);
    await revalidateStorefrontCaches();
    redirectWithStatus(returnTo, "f2Applied", "ProductFitment added");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirectWithStatus(returnTo, "f2Error", "ProductFitment มีอยู่แล้ว ไม่ได้สร้างใหม่");
      return;
    }

    throw error;
  }
}

const refreshClusterCacheSchema = z.object({
  windowKey: z.enum(["last-7-days", "last-30-days"]),
  returnTo: returnToSchema,
});

export async function refreshProductSearchClusterCache(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = refreshClusterCacheSchema.safeParse(raw);
  if (!parsed.success) {
    return redirectWithStatus(String(raw.returnTo ?? ""), "f2Error", "Invalid cluster cache window");
  }

  const session = await requirePermission("product_search_report.view").catch(() => null);
  if (!session?.user?.id) {
    return redirectWithStatus(parsed.data.returnTo, "f2Error", "Missing product search report permission");
  }

  const windowKey: ProductSearchClusterWindowKey = parsed.data.windowKey;
  const definition = PRODUCT_SEARCH_CLUSTER_WINDOWS.find((entry) => entry.key === windowKey);
  if (!definition) {
    return redirectWithStatus(parsed.data.returnTo, "f2Error", "Unknown cluster cache window");
  }

  const now = new Date();
  const range = getRollingWindowRange(definition, now);

  // Load every log row in the rolling window (no take cap) so the cache covers
  // the full cluster set, not just the top 500 rendered live.
  const logs = await db.productSearchLog.findMany({
    where: {
      resultCount: { lte: LOW_RESULT_SEARCH_THRESHOLD },
      createdAt: { gte: range.start, lte: range.end },
    },
    orderBy: { createdAt: "desc" },
    select: { query: true, resultCount: true, source: true, createdAt: true, hitCount: true },
  });

  const rows = buildClusterCacheRows(windowKey, logs, range);

  const requestContext = await getRequestContext();
  await db.$transaction(
    async (tx) => {
      await tx.productSearchClusterCache.deleteMany({ where: { windowKey } });
      if (rows.length > 0) {
        await tx.productSearchClusterCache.createMany({ data: rows });
      }
    },
    { timeout: 30000 },
  );

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...requestContext,
    action: AuditAction.UPDATE,
    entityType: "ProductSearchClusterCache",
    entityId: windowKey,
    entityRef: definition.label,
    after: {
      windowKey,
      rowCount: rows.length,
      windowStart: range.start,
      windowEnd: range.end,
      sourceLogCount: logs.length,
    },
  });

  revalidatePath(REPORT_PATH);
  redirectWithStatus(parsed.data.returnTo, "f2Applied", `รีเฟรช cluster cache "${definition.label}" สำเร็จ (${rows.length} clusters)`);
}
