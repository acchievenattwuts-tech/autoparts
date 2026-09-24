import { normalizeSearchText } from "@/lib/search-normalization";
import { MAX_SYNONYMS_PER_TERM } from "@/lib/search-synonyms";

/**
 * Shared merge for the bulk SearchSynonym import scripts under scripts/.
 *
 * Existing synonyms are curated data (often edited by staff in
 * /admin/master/search-synonyms), so they are kept verbatim and in their
 * original order — an import only ever appends. New values are appended until
 * the row reaches the cap; anything past the cap is returned in
 * `skippedOverCap` for the script to report, never swapped in for an existing
 * synonym.
 *
 * The cap defaults to MAX_SYNONYMS_PER_TERM, the same limit the admin form
 * enforces and the search layer reads, so an import can never write a row the
 * admin form would refuse to save.
 */

export type SynonymImportMergeInput = {
  existing: readonly string[];
  incoming: readonly string[];
  term: string;
  /** Normalized keys owned by other rows; incoming values matching them are ignored. */
  excludeKeys?: ReadonlySet<string>;
  cap?: number;
};

export type SynonymImportMerge = {
  /** Existing synonyms unchanged, followed by the accepted new ones. */
  synonyms: string[];
  added: string[];
  skippedOverCap: string[];
};

export const mergeImportedSynonyms = ({
  existing,
  incoming,
  term,
  excludeKeys,
  cap = MAX_SYNONYMS_PER_TERM,
}: SynonymImportMergeInput): SynonymImportMerge => {
  const seen = new Set<string>([normalizeSearchText(term)]);
  for (const value of existing) seen.add(normalizeSearchText(value));

  const synonyms = [...existing];
  const added: string[] = [];
  const skippedOverCap: string[] = [];

  for (const value of incoming) {
    const clean = value.trim();
    const key = normalizeSearchText(clean);
    if (!clean || !key || seen.has(key) || excludeKeys?.has(key)) continue;
    seen.add(key);
    if (synonyms.length >= cap) {
      skippedOverCap.push(clean);
      continue;
    }
    synonyms.push(clean);
    added.push(clean);
  }

  return { synonyms, added, skippedOverCap };
};

/** One console line for values an import could not add because the row is full. */
export const formatSkippedOverCap = (term: string, merge: SynonymImportMerge, cap = MAX_SYNONYMS_PER_TERM): string =>
  `  ⚠ "${term}" is at the ${cap}-synonym cap — not added: ${merge.skippedOverCap.join(" | ")}`;
