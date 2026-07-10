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
}) {
  const { intent, latestText, history, brandLookup } = input;
  if (!intent || !intent.isProductQuery) {
    return { intent, forceLiteralQuery: false, requiredTokens: [] as string[] };
  }

  const carModelGrounded =
    lineValueHasCustomerEvidence(intent.carModel, latestText, history) ||
    lineModelHasCustomerAliasEvidence(intent.carModel, latestText, history);
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
