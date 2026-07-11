import { buildSearchVariants, normalizeSearchText, tokenizeSearchVariants } from "@/lib/search-normalization";
import type { ChatReplyHistoryItem, ChatSearchIntent } from "@/lib/chat-core/ai-service";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import { resolveBrandVariants } from "@/lib/chat-core/brand-variants";

/**
 * Tokens with 3+ chars and a digit are usually model codes / part fragments in
 * LINE chats (e.g. 709, 2070, STA-7065). Keep them as required recall anchors so
 * a broad search fallback cannot drift to a popular but unrelated car model.
 */
export function extractChatRequiredSearchTokens(text?: string | null): string[] {
  return extractProductSearchRequiredTokens(text);
}

export function lineQueryContainsRequiredTokens(query: string | null | undefined, requiredTokens: string[]) {
  if (requiredTokens.length === 0) return true;
  const queryTokens = new Set(tokenizeSearchVariants(query));
  return requiredTokens.every((token) =>
    buildSearchVariants(token).some((variant) => queryTokens.has(variant)),
  );
}

export function lineValueHasCustomerEvidence(
  value: string | null | undefined,
  latestText: string | null | undefined,
  history: ChatReplyHistoryItem[],
  brandLookup?: ReadonlyMap<string, string[]> | null,
) {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return true;

  const customerText = [
    ...history.filter((turn) => turn.role === "customer").map((turn) => turn.text),
    latestText ?? "",
  ].join(" ");
  const evidenceText = normalizeSearchText(customerText);
  const evidenceTokens = new Set(tokenizeSearchVariants(evidenceText));

  // Generate both English/standard variants AND any Thai brand alternatives
  // (DB-backed alias table, falling back to the hardcoded map). Example: "Toyota"
  // → ["toyota", "โตโยต้า", ...] so "โตโยต้า134" in customer text grounds the
  // evidence even though the classifier returned the English name.
  const allVariants = new Set(buildSearchVariants(normalizedValue));
  for (const brandVariant of resolveBrandVariants(value, brandLookup)) {
    buildSearchVariants(brandVariant).forEach((v) => allVariants.add(v));
  }

  return Array.from(allVariants).some(
    (variant) => evidenceTokens.has(variant) || evidenceText.includes(variant),
  );
}

/**
 * Optimal String Alignment (Damerau-Levenshtein with adjacent transpositions)
 * distance. Common Thai typos are a single edit or an adjacent character swap
 * ("คอล์ย" for "คอยล์"), so a transposition-aware distance is what recognises them.
 */
function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) d[i][0] = i;
  for (let j = 0; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

const typoMaxEdits = (len: number): number => Math.max(1, Math.floor(len / 4));

/**
 * Typo-tolerant evidence: the customer's text contains a MISSPELLING of `value`
 * (single edit / adjacent transposition), so a part word the customer really typed
 * but mis-keyed ("คอล์ยเย็น" for "คอยล์เย็น") still counts as evidence and is NOT
 * dropped as a hallucination. Slides a window over the space-stripped customer text
 * so it works on glued Thai (the raw message before the classifier segmented it).
 * Pure + exported for unit testing.
 */
export function lineValueHasCustomerTypoEvidence(
  value: string | null | undefined,
  latestText: string | null | undefined,
  history: ChatReplyHistoryItem[],
): boolean {
  const target = normalizeSearchText(value).replace(/\s+/g, "");
  // Below 4 chars a 1-edit window matches too much to be reliable evidence.
  if (target.length < 4) return false;

  const haystack = normalizeSearchText(
    [
      ...history.filter((turn) => turn.role === "customer").map((turn) => turn.text),
      latestText ?? "",
    ].join(" "),
  ).replace(/\s+/g, "");
  if (!haystack) return false;

  const maxEdits = typoMaxEdits(target.length);
  const lo = Math.max(1, target.length - maxEdits);
  const hi = target.length + maxEdits;
  for (let start = 0; start < haystack.length; start += 1) {
    for (let len = lo; len <= hi && start + len <= haystack.length; len += 1) {
      if (osaDistance(target, haystack.slice(start, start + len)) <= maxEdits) return true;
    }
  }
  return false;
}

function lineModelHasCustomerAliasEvidence(
  value: string | null | undefined,
  latestText: string | null | undefined,
  history: ChatReplyHistoryItem[],
) {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return true;

  const customerText = [
    ...history.filter((turn) => turn.role === "customer").map((turn) => turn.text),
    latestText ?? "",
  ].join(" ");
  const evidenceTokens = new Set(tokenizeSearchVariants(customerText));

  for (const variant of buildSearchVariants(normalizedValue)) {
    for (const token of variant.split(/\s+/)) {
      if (token.length < 4) continue;
      if (evidenceTokens.has(token)) return true;
    }
  }
  return false;
}

/**
 * Thai↔English MODEL transliteration evidence. The classifier + master data use the
 * English canonical model name ("Strada"), but customers type the Thai spelling
 * ("สตาด้า") — and unlike brands, model transliterations are NOT in the hardcoded
 * variant map. The `modelLookup` (built from the `SearchSynonym` table) bridges
 * them: for the classifier's model, pull every accepted spelling and check the
 * customer text (substring OR token) so a clearly-stated Thai model still grounds
 * the classifier's English value instead of being dropped. Without this, a query
 * like "สายแอร์…สตาด้า2500" loses the vehicle scope and drifts to other models.
 */
function lineModelHasCustomerSynonymEvidence(
  value: string | null | undefined,
  latestText: string | null | undefined,
  history: ChatReplyHistoryItem[],
  modelLookup?: ReadonlyMap<string, string[]> | null,
) {
  if (!value || !modelLookup) return false;
  const variants = modelLookup.get(normalizeSearchText(value));
  if (!variants || variants.length === 0) return false;

  const customerText = normalizeSearchText(
    [
      ...history.filter((turn) => turn.role === "customer").map((turn) => turn.text),
      latestText ?? "",
    ].join(" "),
  );
  if (!customerText) return false;
  const evidenceTokens = new Set(tokenizeSearchVariants(customerText));

  for (const variant of variants) {
    for (const spelling of buildSearchVariants(variant)) {
      if (!spelling) continue;
      if (evidenceTokens.has(spelling) || customerText.includes(spelling)) return true;
    }
  }
  return false;
}

/**
 * Year-specific evidence check. The customer's own words rarely contain the exact
 * 4-digit C.E. year the classifier reports — they type shorthand ("ปี 03" for
 * 2003) or the พ.ศ. form (2546). A literal `String(year)` check would wrongly drop
 * a year the customer really supplied, so accept: the 4-digit C.E. year, its พ.ศ.
 * equivalent, or the 2-digit shorthand (03 → 2003), each bounded so it can't match
 * inside a longer number (a model-code fragment like "STA703").
 */
function lineYearHasCustomerEvidence(
  year: number,
  latestText: string | null | undefined,
  history: ChatReplyHistoryItem[],
): boolean {
  const historyText = history
    .filter((turn) => turn.role === "customer")
    .map((turn) => turn.text)
    .join(" ");
  const latest = latestText ?? "";
  const bounded = (needle: string, haystack: string): boolean =>
    new RegExp(`(?<!\\d)${needle}(?!\\d)`).test(haystack);

  // Unambiguous 4-digit forms (C.E. or พ.ศ. = year + 543) count anywhere in the
  // session — the customer clearly named that exact year.
  const fullText = `${historyText} ${latest}`;
  if (bounded(String(year), fullText)) return true;
  if (bounded(String(year + 543), fullText)) return true;

  // 2-digit shorthand ("03" → 2003) is only accepted in the LATEST turn: a bare
  // "08" left over in history usually belongs to an EARLIER subject, so letting it
  // ground a fresh query's year would re-pin the wrong year (the frame's job, not
  // the guard's). In the current turn it's an intentional, current detail.
  const yy = String(((year % 100) + 100) % 100).padStart(2, "0");
  return bounded(yy, latest);
}

export function guardChatSearchIntent(input: {
  intent: ChatSearchIntent | null;
  latestText?: string | null;
  history: ChatReplyHistoryItem[];
  /** DB-backed brand spelling lookup; falls back to the hardcoded map when omitted. */
  brandLookup?: ReadonlyMap<string, string[]> | null;
  /** DB-backed model spelling lookup (SearchSynonym); grounds Thai↔English model
   *  transliterations ("สตาด้า"↔"Strada"). Omitted → English-only evidence. */
  modelLookup?: ReadonlyMap<string, string[]> | null;
}) {
  const { intent, latestText, history, brandLookup, modelLookup } = input;
  if (!intent || !intent.isProductQuery) {
    return { intent, forceLiteralQuery: false, requiredTokens: [] as string[] };
  }

  const carModelGrounded =
    lineValueHasCustomerEvidence(intent.carModel, latestText, history) ||
    lineModelHasCustomerAliasEvidence(intent.carModel, latestText, history) ||
    lineModelHasCustomerSynonymEvidence(intent.carModel, latestText, history, modelLookup);
  const carBrandGrounded =
    lineValueHasCustomerEvidence(intent.carBrand, latestText, history, brandLookup) ||
    (carModelGrounded && Boolean(intent.carBrand) && Boolean(intent.carModel));
  const carYearGrounded =
    intent.year !== null && lineYearHasCustomerEvidence(intent.year, latestText, history);

  const requiredTokens = extractChatRequiredSearchTokens(latestText);

  // Ground the BRAND and YEAR on EVERY product turn (not only when the text has a
  // model-code/year anchor). Both slots become HARD fitment filters downstream —
  // and on LINE they seed the persistent inquiry frame — so a value the classifier
  // hallucinated, or history-merged from an EARLIER part inquiry, must be dropped
  // even for a plain Thai query (e.g. "คอยเย็นวีออส"). This is safe because both
  // have full evidence coverage: the brand check knows Thai↔English variants
  // (resolveBrandVariants) and the year check knows พ.ศ. + 2-digit shorthand.
  //
  // The MODEL is deliberately grounded ONLY when a required-token anchor is
  // present. Model transliteration ("วีโก้"↔"Vigo") is NOT in the evidence data
  // (only brands are), so grounding a model on a plain Thai turn would wrongly drop
  // a model the customer really typed and make the gate re-ask for the car they
  // already gave. With an anchor present we still enforce it (the original guarded
  // behavior + forceLiteralQuery below).
  const groundedIntent: ChatSearchIntent = {
    ...intent,
    carBrand: carBrandGrounded ? intent.carBrand : null,
    carModel: requiredTokens.length === 0 ? intent.carModel : carModelGrounded ? intent.carModel : null,
    year: carYearGrounded ? intent.year : null,
  };

  if (requiredTokens.length === 0) {
    // No model-code/year anchor to enforce a literal query, but the brand/year are
    // already grounded above so a hallucinated brand/year can't hard-filter here.
    return { intent: groundedIntent, forceLiteralQuery: false, requiredTokens };
  }

  const queryHasRequiredTokens = lineQueryContainsRequiredTokens(intent.query, requiredTokens);
  const forceLiteralQuery = !queryHasRequiredTokens || !carBrandGrounded || !carModelGrounded;

  return {
    intent: groundedIntent,
    forceLiteralQuery,
    requiredTokens,
  };
}
