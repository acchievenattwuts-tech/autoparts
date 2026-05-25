import { normalizeSearchText } from "@/lib/search-normalization";

export const PRODUCT_SEARCH_CANDIDATE_MAX_SYNONYMS = 10;

export type MergeSearchSynonymCandidateResult =
  | { success: true; synonyms: string[]; changed: boolean }
  | { success: false; error: "MAX_SYNONYMS_REACHED" };

export const mergeSearchSynonymCandidate = (
  existingSynonyms: string[],
  term: string,
  candidate: string,
): MergeSearchSynonymCandidateResult => {
  const normalizedTerm = normalizeSearchText(term);
  const normalizedCandidate = normalizeSearchText(candidate);
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const synonym of existingSynonyms) {
    const trimmed = synonym.trim();
    const key = normalizeSearchText(trimmed);
    if (!trimmed || !key || key === normalizedTerm || seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }

  if (!normalizedCandidate || normalizedCandidate === normalizedTerm || seen.has(normalizedCandidate)) {
    return { success: true, synonyms: merged, changed: merged.length !== existingSynonyms.length };
  }

  if (merged.length >= PRODUCT_SEARCH_CANDIDATE_MAX_SYNONYMS) {
    return { success: false, error: "MAX_SYNONYMS_REACHED" };
  }

  merged.push(candidate.trim());
  return { success: true, synonyms: merged, changed: true };
};
