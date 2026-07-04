import { buildSearchVariants, normalizeSearchText, tokenizeSearchVariants } from "@/lib/search-normalization";
import type { LineReplyHistoryItem, LineSearchIntent } from "@/lib/chat-core/ai-service";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import { resolveBrandVariants } from "@/lib/chat-core/brand-variants";

/**
 * Tokens with 3+ chars and a digit are usually model codes / part fragments in
 * LINE chats (e.g. 709, 2070, STA-7065). Keep them as required recall anchors so
 * a broad search fallback cannot drift to a popular but unrelated car model.
 */
export function extractLineRequiredSearchTokens(text?: string | null): string[] {
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
  history: LineReplyHistoryItem[],
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
  history: LineReplyHistoryItem[],
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

export function guardLineSearchIntent(input: {
  intent: LineSearchIntent | null;
  latestText?: string | null;
  history: LineReplyHistoryItem[];
  /** DB-backed brand spelling lookup; falls back to the hardcoded map when omitted. */
  brandLookup?: ReadonlyMap<string, string[]> | null;
}) {
  const { intent, latestText, history, brandLookup } = input;
  if (!intent || !intent.isProductQuery) {
    return { intent, forceLiteralQuery: false, requiredTokens: [] as string[] };
  }

  const requiredTokens = extractLineRequiredSearchTokens(latestText);
  if (requiredTokens.length === 0) {
    return { intent, forceLiteralQuery: false, requiredTokens };
  }

  const carModelGrounded =
    lineValueHasCustomerEvidence(intent.carModel, latestText, history) ||
    lineModelHasCustomerAliasEvidence(intent.carModel, latestText, history);
  const carBrandGrounded =
    lineValueHasCustomerEvidence(intent.carBrand, latestText, history, brandLookup) ||
    (carModelGrounded && Boolean(intent.carBrand) && Boolean(intent.carModel));
  // The model year is a hard fitment filter, so a year the customer never typed
  // (history-merged by the classifier from an EARLIER part inquiry) must be
  // dropped just like an ungrounded brand/model — otherwise a stale "ปี08" pins a
  // fresh query to the wrong year and hides valid matches.
  const carYearGrounded =
    intent.year !== null && lineValueHasCustomerEvidence(String(intent.year), latestText, history);
  const queryHasRequiredTokens = lineQueryContainsRequiredTokens(intent.query, requiredTokens);
  const forceLiteralQuery = !queryHasRequiredTokens || !carBrandGrounded || !carModelGrounded;

  return {
    intent: {
      ...intent,
      carBrand: carBrandGrounded ? intent.carBrand : null,
      carModel: carModelGrounded ? intent.carModel : null,
      year: carYearGrounded ? intent.year : null,
    },
    forceLiteralQuery,
    requiredTokens,
  };
}
