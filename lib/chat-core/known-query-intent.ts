import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { normalizeSearchText } from "@/lib/search-normalization";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";

/**
 * Rule-based "known query" resolver backed by the SearchKeyword dictionary.
 *
 * When EVERY whitespace token of a query decomposes cleanly into a known thing —
 * a dictionary term (category / car brand / car model / parts brand / product /
 * synonym), a 4-digit car year, or a code-like part fragment — we can derive the
 * search intent (filters) WITHOUT calling the LLM classifier. This is the fast
 * path for the common, unambiguous searches ("ผ้าเบรค Vios", "Toyota Vios 2015",
 * "คอมแอร์"), saving the Gemini round-trip on both the storefront and LINE OA.
 *
 * If anything is unrecognised (colloquial wording, typo, free-form sentence,
 * carried-over context), it returns null and the caller falls back to the LLM —
 * so the precise behaviour for hard queries is preserved.
 */

export type KnownQueryIntent = {
  query: string;
  requiredTokens: string[];
  categoryName: string | null;
  carBrandName: string | null;
  carModelName: string | null;
  fitmentYear: number | null;
  /** True when the intent names BOTH a part (category) and a vehicle (brand/model),
   *  or contains a code anchor — i.e. it is self-contained and would not benefit
   *  from conversational context-merge. LINE uses this to stay conservative. */
  contextFree: boolean;
};

const MAX_TOKENS = 8;

const isCarYearToken = (token: string): boolean => {
  if (!/^\d{4}$/.test(token)) return false;
  const year = Number(token);
  return year >= 1980 && year <= 2035;
};

/** Picks the first match of a given kind from a token's resolved entries. */
export type Entry = { kind: string; term: string };

export type KnownQueryFilterResult = {
  categoryName: string | null;
  carBrandName: string | null;
  carModelName: string | null;
  contextFree: boolean;
};

/**
 * Pure hard-filter assignment for a resolved known query. Extracted from
 * {@link resolveKnownQueryIntent} so the promotion (Option A) and context-free
 * (Option B) rules can be unit-tested without a database.
 *
 * - `entriesByNorm`: each token's own SearchKeyword hits.
 * - `expandedByNorm`: for a synonym term, its canonical carModel/carBrand/category
 *    hits (keyed by the normalized synonym term).
 */
export function deriveKnownQueryFilters(params: {
  dictionaryNorms: string[];
  entriesByNorm: Map<string, Entry[]>;
  expandedByNorm: Map<string, Entry[]>;
  requiredTokens: string[];
}): KnownQueryFilterResult {
  const { dictionaryNorms, entriesByNorm, expandedByNorm, requiredTokens } = params;

  // A token's own dictionary entry wins first; if it only resolved to a synonym,
  // fall back to that synonym's expanded vehicle/category entry (Option A). Parts
  // brand / product tokens stay free text.
  const pick = (norm: string, kind: string): string | null => {
    const entries = entriesByNorm.get(norm);
    if (!entries) return null;
    const direct = entries.find((e) => e.kind === kind)?.term;
    if (direct) return direct;
    for (const entry of entries) {
      if (entry.kind !== "synonym") continue;
      const expanded = expandedByNorm.get(normalizeSearchText(entry.term));
      const hit = expanded?.find((e) => e.kind === kind)?.term;
      if (hit) return hit;
    }
    return null;
  };

  let categoryName: string | null = null;
  let carBrandName: string | null = null;
  let carModelName: string | null = null;
  for (const norm of dictionaryNorms) {
    if (!carModelName) carModelName = pick(norm, "carModel");
    if (!carBrandName) carBrandName = pick(norm, "carBrand");
    if (!categoryName) categoryName = pick(norm, "category");
  }

  // Option B — a bare pure-numeric token (e.g. engine displacement "2500") is NOT a
  // real part-number anchor: on its own it must not mark the query self-contained
  // and skip the LLM classifier, which would otherwise catch a mistyped vehicle we
  // could not resolve. Only a code carrying a letter or hyphen (a genuine part
  // number / SKU) qualifies. requiredTokens are already normalized (lowercased).
  const hasStrongCodeAnchor = requiredTokens.some(
    (token) => /[a-z]/.test(token) || token.includes("-"),
  );
  const contextFree =
    hasStrongCodeAnchor || (Boolean(categoryName) && Boolean(carBrandName || carModelName));

  return { categoryName, carBrandName, carModelName, contextFree };
}

export async function resolveKnownQueryIntent(
  rawQuery: string | null | undefined,
): Promise<KnownQueryIntent | null> {
  const query = rawQuery?.trim();
  if (!query) return null;

  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return null;

  const requiredTokens = extractProductSearchRequiredTokens(query);
  const codeSet = new Set(requiredTokens);

  let fitmentYear: number | null = null;
  let nonYearTokenCount = 0;
  const dictionaryNorms: string[] = [];

  for (const token of tokens) {
    if (isCarYearToken(token)) {
      fitmentYear = Number(token);
      continue;
    }
    nonYearTokenCount += 1;

    const norm = normalizeSearchText(token);
    if (!norm) return null; // punctuation-only token → treat as unknown

    if (codeSet.has(norm)) {
      continue; // code-like fragment is a known recall anchor (see contextFree below)
    }

    dictionaryNorms.push(norm);
  }

  // A lone year (or empty) is not a "known" search — let the normal path handle it.
  if (nonYearTokenCount === 0) return null;

  // Resolve every remaining token against the dictionary in ONE indexed query.
  const entriesByNorm = new Map<string, Entry[]>();
  if (dictionaryNorms.length > 0) {
    const rows = await db.$queryRaw<Array<{ normalized: string; kind: string; term: string }>>(
      Prisma.sql`
        SELECT normalized, kind, term
        FROM "SearchKeyword"
        WHERE normalized IN (${Prisma.join(Array.from(new Set(dictionaryNorms)))})
      `,
    );
    for (const row of rows) {
      const list = entriesByNorm.get(row.normalized) ?? [];
      list.push({ kind: row.kind, term: row.term });
      entriesByNorm.set(row.normalized, list);
    }
    // Every dictionary token must resolve — otherwise the query is NOT fully known.
    for (const norm of dictionaryNorms) {
      if (!entriesByNorm.has(norm)) return null;
    }
  }

  // Option A — synonym → vehicle/category promotion. A misspelling is often stored
  // only as a SYNONYM row (e.g. normalized "starda" → term "Strada"), never as a
  // direct carModel row. Without this pass the synonym term stays free-text and the
  // vehicle hard filter is lost, so the search silently ignores the (mistyped) model
  // and returns every product in the category. So: take each synonym hit's canonical
  // `term`, re-resolve it against the dictionary, and expose the resulting
  // carModel/carBrand/category entries under the SAME token — as if the customer had
  // typed the correct word. Only these three kinds are expanded (never product /
  // synonym), so a synonym can only ever sharpen a filter, never widen the query.
  const synonymTermNorms = new Set<string>();
  for (const entries of entriesByNorm.values()) {
    for (const entry of entries) {
      if (entry.kind !== "synonym") continue;
      const termNorm = normalizeSearchText(entry.term);
      if (termNorm) synonymTermNorms.add(termNorm);
    }
  }
  const expandedByNorm = new Map<string, Entry[]>();
  if (synonymTermNorms.size > 0) {
    const rows = await db.$queryRaw<Array<{ normalized: string; kind: string; term: string }>>(
      Prisma.sql`
        SELECT normalized, kind, term
        FROM "SearchKeyword"
        WHERE normalized IN (${Prisma.join(Array.from(synonymTermNorms))})
          AND kind IN ('carModel', 'carBrand', 'category')
      `,
    );
    for (const row of rows) {
      const list = expandedByNorm.get(row.normalized) ?? [];
      list.push({ kind: row.kind, term: row.term });
      expandedByNorm.set(row.normalized, list);
    }
  }

  // Assign hard filters by kind priority (carModel > carBrand > category, with
  // synonym promotion) and decide context-freedom — pure, unit-tested logic.
  const { categoryName, carBrandName, carModelName, contextFree } = deriveKnownQueryFilters({
    dictionaryNorms,
    entriesByNorm,
    expandedByNorm,
    requiredTokens,
  });

  return {
    query,
    requiredTokens,
    categoryName,
    carBrandName,
    carModelName,
    fitmentYear,
    contextFree,
  };
}
