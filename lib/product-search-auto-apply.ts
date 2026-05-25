import { mergeSearchSynonymCandidate } from "@/lib/product-search-candidate-apply";
import type { ProductSearchLogCluster } from "@/lib/product-search-log-analysis";
import { normalizeSearchText } from "@/lib/search-normalization";

export type ProductSearchAutoApplyReason =
  | "ELIGIBLE"
  | "UNSUPPORTED_CANDIDATE_ACTION"
  | "ALREADY_REVIEWED"
  | "QUERY_TOO_SHORT"
  | "NUMERIC_OR_CODE_LIKE_QUERY"
  | "NO_SYNONYM_VARIANTS"
  | "DUPLICATE_SYNONYM"
  | "MAX_SYNONYMS_REACHED";

export type ProductSearchAutoApplySynonym = {
  id: string;
  term: string;
  synonyms: string[];
  language: string | null;
  isActive: boolean;
};

export type ProductSearchAutoApplyOutcome = {
  status: string;
};

export type ProductSearchAutoApplyPlanItem = {
  normalizedQuery: string;
  candidateAction: ProductSearchLogCluster["candidateAction"];
  term: string;
  rawQueries: string[];
  synonymsToAdd: string[];
  existingSynonymId: string | null;
  language: string | null;
  eligible: boolean;
  dryRunOnly: boolean;
  reason: ProductSearchAutoApplyReason;
};

export const PRODUCT_SEARCH_AUTO_APPLY_SYNONYMS_ENABLED_KEY = "product_search_auto_apply_synonyms_enabled";

const REVIEW_PENDING_STATUSES = new Set(["PENDING", "pending"]);

const isCodeLikeQuery = (value: string): boolean => {
  if (/\d/.test(value)) return true;
  if (/[a-z]+[-_/]?\d+|\d+[-_/]?[a-z]+/i.test(value)) return true;
  return false;
};

const findExistingSynonym = (
  existingSynonyms: ProductSearchAutoApplySynonym[],
  normalizedTerm: string,
): ProductSearchAutoApplySynonym | null =>
  existingSynonyms.find((synonym) => normalizeSearchText(synonym.term) === normalizedTerm) ?? null;

const hasDuplicateSynonymElsewhere = (
  existingSynonyms: ProductSearchAutoApplySynonym[],
  normalizedTerm: string,
  normalizedCandidate: string,
): boolean =>
  existingSynonyms.some((synonym) => {
    const synonymTerm = normalizeSearchText(synonym.term);
    if (synonymTerm === normalizedTerm) return false;
    if (synonymTerm === normalizedCandidate) return true;
    return synonym.synonyms.some((value) => normalizeSearchText(value) === normalizedCandidate);
  });

export const parseProductSearchAutoApplyEnabledSetting = (value: string | null | undefined): boolean =>
  value?.trim().toLowerCase() === "true";

export const buildAutoApplySearchSynonymPlan = ({
  clusters,
  existingSynonyms,
  outcomeByKey,
}: {
  clusters: ProductSearchLogCluster[];
  existingSynonyms: ProductSearchAutoApplySynonym[];
  outcomeByKey: Map<string, ProductSearchAutoApplyOutcome>;
}): ProductSearchAutoApplyPlanItem[] =>
  clusters.map((cluster) => {
    const normalizedQuery = normalizeSearchText(cluster.normalizedQuery);
    const rawQueries = cluster.rawQueries.map((query) => query.trim()).filter(Boolean);
    const base = {
      normalizedQuery,
      candidateAction: cluster.candidateAction,
      term: normalizedQuery,
      rawQueries,
      synonymsToAdd: [],
      existingSynonymId: null,
      language: null,
      eligible: false,
      dryRunOnly: true,
    } satisfies Omit<ProductSearchAutoApplyPlanItem, "reason">;

    if (cluster.candidateAction !== "search-synonym") {
      return { ...base, reason: "UNSUPPORTED_CANDIDATE_ACTION" };
    }

    const outcome = outcomeByKey.get(`${normalizedQuery}\u0000${cluster.candidateAction}`);
    if (outcome && !REVIEW_PENDING_STATUSES.has(outcome.status)) {
      return { ...base, reason: "ALREADY_REVIEWED" };
    }

    if (normalizedQuery.length < 3) {
      return { ...base, reason: "QUERY_TOO_SHORT" };
    }

    if (isCodeLikeQuery(normalizedQuery)) {
      return { ...base, reason: "NUMERIC_OR_CODE_LIKE_QUERY" };
    }

    const existing = findExistingSynonym(existingSynonyms, normalizedQuery);
    const candidates = rawQueries
      .filter((query) => {
        const normalizedCandidate = normalizeSearchText(query);
        return normalizedCandidate && normalizedCandidate !== normalizedQuery;
      })
      .filter((query, index, values) => {
        const normalizedCandidate = normalizeSearchText(query);
        return values.findIndex((value) => normalizeSearchText(value) === normalizedCandidate) === index;
      });

    if (candidates.length === 0) {
      return { ...base, existingSynonymId: existing?.id ?? null, language: existing?.language ?? null, reason: "NO_SYNONYM_VARIANTS" };
    }

    const synonymsToAdd: string[] = [];
    let currentSynonyms = existing?.synonyms ?? [];
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeSearchText(candidate);
      if (hasDuplicateSynonymElsewhere(existingSynonyms, normalizedQuery, normalizedCandidate)) {
        return { ...base, existingSynonymId: existing?.id ?? null, language: existing?.language ?? null, reason: "DUPLICATE_SYNONYM" };
      }

      const merged = mergeSearchSynonymCandidate(currentSynonyms, normalizedQuery, candidate);
      if (!merged.success) {
        return { ...base, existingSynonymId: existing?.id ?? null, language: existing?.language ?? null, reason: "MAX_SYNONYMS_REACHED" };
      }

      if (merged.changed) {
        synonymsToAdd.push(candidate);
        currentSynonyms = merged.synonyms;
      }
    }

    if (synonymsToAdd.length === 0) {
      return { ...base, existingSynonymId: existing?.id ?? null, language: existing?.language ?? null, reason: "DUPLICATE_SYNONYM" };
    }

    return {
      ...base,
      synonymsToAdd,
      existingSynonymId: existing?.id ?? null,
      language: existing?.language ?? null,
      eligible: true,
      reason: "ELIGIBLE",
    };
  });
