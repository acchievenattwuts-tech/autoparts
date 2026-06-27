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
type Entry = { kind: string; term: string };

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
  let hasCode = false;
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
      hasCode = true;
      continue; // code-like fragment is a known recall anchor
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

  // Assign hard filters by kind priority (carModel > carBrand > category). Parts
  // brand / product / synonym tokens are "known" but kept only as free text.
  let categoryName: string | null = null;
  let carBrandName: string | null = null;
  let carModelName: string | null = null;

  const pick = (norm: string, kind: string): string | null =>
    entriesByNorm.get(norm)?.find((e) => e.kind === kind)?.term ?? null;

  for (const norm of dictionaryNorms) {
    if (!carModelName) carModelName = pick(norm, "carModel");
    if (!carBrandName) carBrandName = pick(norm, "carBrand");
    if (!categoryName) categoryName = pick(norm, "category");
  }

  const contextFree = hasCode || (Boolean(categoryName) && Boolean(carBrandName || carModelName));

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
