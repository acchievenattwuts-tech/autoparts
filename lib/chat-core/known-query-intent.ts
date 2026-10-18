import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { normalizeSearchText } from "@/lib/search-normalization";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import { splitThaiGraphemes } from "@/lib/thai-segment";
import type { ChatSearchIntent } from "@/lib/chat-core/ai-service";

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
/**
 * A token's term of one kind. Its own dictionary entry wins first; if it only
 * resolved to a synonym, fall back to that synonym's expanded vehicle/category
 * entry (Option A). Parts brand / product tokens stay free text.
 */
export function pickKnownQueryTerm(
  norm: string,
  kind: string,
  entriesByNorm: Map<string, Entry[]>,
  expandedByNorm: Map<string, Entry[]>,
): string | null {
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
}

export function deriveKnownQueryFilters(params: {
  dictionaryNorms: string[];
  entriesByNorm: Map<string, Entry[]>;
  expandedByNorm: Map<string, Entry[]>;
  requiredTokens: string[];
}): KnownQueryFilterResult {
  const { dictionaryNorms, entriesByNorm, expandedByNorm, requiredTokens } = params;
  const pick = (norm: string, kind: string): string | null =>
    pickKnownQueryTerm(norm, kind, entriesByNorm, expandedByNorm);

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

type KnownQueryEntries = {
  entriesByNorm: Map<string, Entry[]>;
  expandedByNorm: Map<string, Entry[]>;
};

/**
 * SearchKeyword hits for each normalized token, plus the Option A synonym
 * expansion. At most two indexed queries; none when `norms` is empty.
 */
async function lookupKnownQueryEntries(norms: string[]): Promise<KnownQueryEntries> {
  const entriesByNorm = new Map<string, Entry[]>();
  const expandedByNorm = new Map<string, Entry[]>();
  const uniqueNorms = Array.from(new Set(norms));
  if (uniqueNorms.length === 0) return { entriesByNorm, expandedByNorm };

  const rows = await db.$queryRaw<Array<{ normalized: string; kind: string; term: string }>>(
    Prisma.sql`
      SELECT normalized, kind, term
      FROM "SearchKeyword"
      WHERE normalized IN (${Prisma.join(uniqueNorms)})
    `,
  );
  for (const row of rows) {
    const list = entriesByNorm.get(row.normalized) ?? [];
    list.push({ kind: row.kind, term: row.term });
    entriesByNorm.set(row.normalized, list);
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
  if (synonymTermNorms.size > 0) {
    const expandedRows = await db.$queryRaw<Array<{ normalized: string; kind: string; term: string }>>(
      Prisma.sql`
        SELECT normalized, kind, term
        FROM "SearchKeyword"
        WHERE normalized IN (${Prisma.join(Array.from(synonymTermNorms))})
          AND kind IN ('carModel', 'carBrand', 'category')
      `,
    );
    for (const row of expandedRows) {
      const list = expandedByNorm.get(row.normalized) ?? [];
      list.push({ kind: row.kind, term: row.term });
      expandedByNorm.set(row.normalized, list);
    }
  }

  return { entriesByNorm, expandedByNorm };
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
  // Code-shaped vehicle names are common (AE101, KUN25, TGN40). They must still
  // be looked up in SearchKeyword before we assume they are part numbers. Keep a
  // separate set for ordinary words, because those MUST resolve for the whole
  // query to qualify as known; a genuine catalog code such as P0368 is allowed
  // to have no SearchKeyword row and is validated later by the catalog resolver.
  const dictionaryNorms: string[] = [];
  const requiredDictionaryNorms: string[] = [];

  for (const token of tokens) {
    if (isCarYearToken(token)) {
      fitmentYear = Number(token);
      continue;
    }
    nonYearTokenCount += 1;

    const norm = normalizeSearchText(token);
    if (!norm) return null; // punctuation-only token → treat as unknown

    dictionaryNorms.push(norm);
    if (!codeSet.has(norm)) {
      requiredDictionaryNorms.push(norm);
    }
  }

  // A lone year (or empty) is not a "known" search — let the normal path handle it.
  if (nonYearTokenCount === 0) return null;

  // Resolve every remaining token against the dictionary in ONE indexed query.
  const { entriesByNorm, expandedByNorm } = await lookupKnownQueryEntries(dictionaryNorms);
  // Every ordinary dictionary token must resolve — otherwise the query is NOT
  // fully known. Code-shaped tokens are optional here: an unresolved P0368 is
  // still a valid catalog-code candidate, while a resolved AE101 can now be
  // promoted through its synonym to the AE100-101 carModel below.
  for (const norm of requiredDictionaryNorms) {
    if (!entriesByNorm.has(norm)) return null;
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

// ── Glued Thai questions (classifier-failure fallback) ───────────────────────
//
// Customers type a whole question without spaces ("มีคอยเย็นมิราจไหมครับ"), so the
// whitespace resolver above sees ONE unknown token. When the LLM classifier is down
// (Gemini 503 / timeout — LINE 2026-10-18), that left the turn with no part and no
// car and it was handed to an admin although both words are in the dictionary.
// This resolver splits Thai into grapheme clusters and takes the longest
// dictionary word at each position (maximal matching) — ICU word segmentation is
// not used because it cuts across real boundaries ("วีออสมี" → "วี|ออ|สมี"). It
// drops question particles and stays as strict as the whitespace resolver: any
// other leftover text → null.

/** Longest dictionary word or particle tried, in grapheme clusters ("เอ็กซ์แพนชั่นวาล์ว" = 10). */
const MAX_PIECES_PER_WORD = 14;
/** A message longer than this is not one product question — leave it to the caller. */
const MAX_GLUED_PIECES = 48;

/**
 * Words that carry no product meaning in a glued question. Dropped only when they
 * did not join into a longer dictionary word. Never add a word that changes WHAT
 * is asked (ล้าง, น้ำยา, มอเตอร์, ไม่ …) — an unknown leftover must keep the query
 * unresolved so the turn goes to an admin as before. Price words are left out on
 * purpose: price turns have their own rule path.
 */
const GLUED_QUERY_FILLER_WORDS = new Set([
  "มี",
  "ไหม",
  "มั้ย",
  "มั๊ย",
  "ไม๊",
  "ใหม",
  "ครับ",
  "คับ",
  "ค้าบ",
  "คร้าบ",
  "ครับผม",
  "ค่ะ",
  "คะ",
  "ค่า",
  "จ้า",
  "จ้ะ",
  "นะ",
  "หน่อย",
  "บ้าง",
  "ด้วย",
  "เลย",
  "ยัง",
  "อยู่",
  "หรือเปล่า",
  "เปล่า",
  "ป่าว",
  "ขอ",
  "หา",
  "อยาก",
  "ได้",
  "ต้องการ",
  "สอบถาม",
  "ของ",
  "ตัว",
  "รถ",
  "รุ่น",
  "ปี",
  "ใส่",
  "สำหรับ",
]);

const THAI_CHAR_RE = /[฀-๿]/;
const THAI_LATIN_BOUNDARY = /([฀-๿])([a-z0-9])/g;
const LATIN_THAI_BOUNDARY = /([a-z0-9])([฀-๿])/g;

const isThaiPiece = (piece: string): boolean => THAI_CHAR_RE.test(piece);

/** How many pieces from `start` may join into one word: Thai graphemes join, other tokens stand alone. */
function joinableSpan(pieces: string[], start: number): number {
  if (!isThaiPiece(pieces[start])) return 1;
  let span = 1;
  while (span < MAX_PIECES_PER_WORD && start + span < pieces.length && isThaiPiece(pieces[start + span])) {
    span += 1;
  }
  return span;
}

/** The longest run from `start` (at most `maxSpan`, at least `minSpan` pieces) that `accept` takes. */
function longestAcceptedSpan(
  pieces: string[],
  start: number,
  maxSpan: number,
  minSpan: number,
  accept: (candidate: string) => boolean,
): { text: string; span: number } | null {
  for (let span = maxSpan; span >= minSpan; span -= 1) {
    const text = pieces.slice(start, start + span).join("");
    if (accept(text)) return { text, span };
  }
  return null;
}

/**
 * Maximal matching over ordered pieces (Thai grapheme clusters and whole non-Thai
 * tokens). At each position the LONGEST dictionary word (`isKnown`, at least two
 * graphemes for Thai) is taken; otherwise the longest particle is dropped;
 * otherwise a code token (`isCode`) is kept; anything else means the message is
 * not fully known → null. A particle never counts as a dictionary word, so it can
 * never add a filter. Pure — unit-tested without a database.
 */
export function planGluedQueryWords(
  pieces: string[],
  isKnown: (norm: string) => boolean,
  isCode: (norm: string) => boolean = () => false,
): string[] | null {
  const words: string[] = [];
  let index = 0;
  while (index < pieces.length) {
    const maxSpan = joinableSpan(pieces, index);
    const minWordSpan = isThaiPiece(pieces[index]) ? Math.min(2, maxSpan) : 1;
    const word = longestAcceptedSpan(
      pieces,
      index,
      maxSpan,
      minWordSpan,
      (candidate) => !GLUED_QUERY_FILLER_WORDS.has(candidate) && isKnown(candidate),
    );
    if (word && (word.span >= 2 || !isThaiPiece(pieces[index]))) {
      words.push(word.text);
      index += word.span;
      continue;
    }
    const filler = longestAcceptedSpan(pieces, index, maxSpan, 1, (candidate) =>
      GLUED_QUERY_FILLER_WORDS.has(candidate),
    );
    if (filler) {
      index += filler.span;
      continue;
    }
    if (isCode(pieces[index])) {
      words.push(pieces[index]);
      index += 1;
      continue;
    }
    return null;
  }
  return words.length > 0 ? words : null;
}

/** Splits a message into ordered pieces: grapheme clusters for Thai runs, whole tokens otherwise. */
function splitGluedQueryPieces(text: string): { pieces: string[]; fitmentYear: number | null } {
  const spaced = normalizeSearchText(text)
    .replace(THAI_LATIN_BOUNDARY, "$1 $2")
    .replace(LATIN_THAI_BOUNDARY, "$1 $2");
  const pieces: string[] = [];
  let fitmentYear: number | null = null;
  for (const token of spaced.split(/\s+/).filter(Boolean)) {
    if (isCarYearToken(token)) {
      fitmentYear ??= Number(token);
      continue;
    }
    if (THAI_CHAR_RE.test(token)) {
      pieces.push(...splitThaiGraphemes(token));
    } else {
      pieces.push(token);
    }
  }
  return { pieces, fitmentYear };
}

/** Every joinable run of pieces that could be a dictionary word — the lookup set. */
function buildGluedQueryCandidates(pieces: string[]): string[] {
  const candidates = new Set<string>();
  for (let start = 0; start < pieces.length; start += 1) {
    const maxSpan = joinableSpan(pieces, start);
    for (let span = 1; span <= maxSpan; span += 1) {
      const candidate = pieces.slice(start, start + span).join("");
      if (!GLUED_QUERY_FILLER_WORDS.has(candidate)) candidates.add(candidate);
    }
  }
  return Array.from(candidates);
}

/**
 * {@link resolveKnownQueryIntent} for a message typed without spaces. Returns null
 * unless every non-particle word is a dictionary term (or a part code), and when
 * the words name more than one part category or car model — a mixed question is
 * left to the caller's admin hand-off rather than guessed. Callers use it only
 * when the LLM classifier failed, and should require `contextFree`.
 */
export async function resolveGluedKnownQueryIntent(
  rawQuery: string | null | undefined,
): Promise<KnownQueryIntent | null> {
  const text = rawQuery?.trim();
  if (!text) return null;

  const { pieces, fitmentYear } = splitGluedQueryPieces(text);
  if (pieces.length === 0 || pieces.length > MAX_GLUED_PIECES) return null;

  const codeSet = new Set(extractProductSearchRequiredTokens(pieces.join(" ")));
  const { entriesByNorm, expandedByNorm } = await lookupKnownQueryEntries(
    buildGluedQueryCandidates(pieces),
  );
  const words = planGluedQueryWords(
    pieces,
    (norm) => entriesByNorm.has(norm),
    (norm) => codeSet.has(norm),
  );
  if (!words) return null;

  const pick = (kind: string) =>
    new Set(
      words
        .map((word) => pickKnownQueryTerm(word, kind, entriesByNorm, expandedByNorm))
        .filter((term): term is string => Boolean(term)),
    );
  if (pick("category").size > 1 || pick("carModel").size > 1) return null;

  const query = [...words, ...(fitmentYear === null ? [] : [String(fitmentYear)])].join(" ");
  const requiredTokens = extractProductSearchRequiredTokens(query);
  const { categoryName, carBrandName, carModelName, contextFree } = deriveKnownQueryFilters({
    dictionaryNorms: words,
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

/** The classifier-shaped product intent for a dictionary-resolved query (LINE and Messenger). */
export function knownQueryIntentToChatSearchIntent(known: KnownQueryIntent): ChatSearchIntent {
  return {
    group: "product",
    query: known.query,
    isProductQuery: true,
    partType: known.categoryName,
    carBrand: known.carBrandName,
    carModel: known.carModelName,
    year: known.fitmentYear,
    partKind: null,
    tooBroad: false,
  };
}
