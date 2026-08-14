import { buildSearchVariants, normalizeSearchText, tokenizeSearchVariants } from "@/lib/search-normalization";
import type { ChatReplyHistoryItem, ChatSearchIntent } from "@/lib/chat-core/ai-service";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import { resolveBrandVariants } from "@/lib/chat-core/brand-variants";
import { containsWithinEditDistance, typoMaxEdits } from "@/lib/chat-core/typo-distance";
import type { CarModelGroundingLookup } from "@/lib/car-model-alias-cache";

export type ChatModelGroundingEvidenceSource =
  | "LITERAL_CANONICAL"
  | "SAFE_SYNONYM"
  | "LATEST_MENTION_TYPO"
  | "NO_EVIDENCE"
  | "LOOKUP_UNAVAILABLE";

export type ChatModelGroundingShadow = {
  evaluated: boolean;
  rawModel: string;
  currentModel: string | null;
  candidateModel: string | null;
  wouldChange: boolean;
  evidenceSource: ChatModelGroundingEvidenceSource;
  matchedEvidence: string | null;
  ambiguousVariantCount: number;
};

export type ChatExplicitModelEvidence = {
  canonicalModel: string;
  matchedEvidence: string;
};

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

/**
 * Verifies the classifier's `carMentionInLatest` — the customer's own words for
 * the vehicle in the LATEST message — really occurs in that message.
 *
 * The field is the only signal that separates "the customer named a car in THIS
 * turn" from "the classifier merged a car out of the conversation history", which
 * is what decides whether a carried-over vehicle may still answer this turn. Since
 * it is produced by the LLM it is never trusted on its own: an unverifiable value
 * is treated as absent, i.e. the previous carry-over behaviour.
 *
 * Whitespace is ignored on both sides — Thai is written without spaces, so the
 * model may return "ซิ้ตี้" for the run-on text "พัดลมโบซิ้ตี้ปี12", or echo a
 * spaced form of a token the customer typed compactly.
 */
export function chatCarMentionOccursInLatest(
  mention: string | null | undefined,
  latestText: string | null | undefined,
): boolean {
  const needle = normalizeSearchText(mention).replace(/\s+/g, "");
  if (!needle) return false;
  const haystack = normalizeSearchText(latestText).replace(/\s+/g, "");
  return haystack.includes(needle);
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

  return containsWithinEditDistance(target, haystack, typoMaxEdits(target.length));
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

const LATIN_ONLY_MODEL_VARIANT_RE = /^[a-z0-9\s-]+$/;

function customerContainsExactModelSpelling(
  customerText: string,
  customerCompact: string,
  customerTokens: ReadonlySet<string>,
  spelling: string,
): boolean {
  if (customerTokens.has(spelling)) return true;
  const compact = spelling.replace(/\s+/g, "");
  if (!compact || compact.length < 4) return false;
  if (!LATIN_ONLY_MODEL_VARIANT_RE.test(spelling)) return customerCompact.includes(compact);

  // Latin model names need word boundaries: "City" must not match the tail of
  // "velocity". Allow common separators inside compound names (BT-50 Pro).
  const escaped = spelling
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[\s-]+/g, "[\\s\\-_/\\.,]*");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(customerText);
}

/**
 * Broad search aliases are not automatically safe hard-filter evidence. A Latin
 * word that neither contains the canonical model nor resembles it by one edit
 * (e.g. D-Max aliases "all new" / "spark") stays recall-only. Thai
 * transliterations and model-code-like spellings remain eligible.
 */
function isStructurallySafeModelEvidence(variant: string, canonicalModel: string): boolean {
  const compact = normalizeSearchText(variant).replace(/\s+/g, "");
  const canonical = normalizeSearchText(canonicalModel).replace(/\s+/g, "");
  if (!compact || !canonical) return false;
  if (!LATIN_ONLY_MODEL_VARIANT_RE.test(compact)) return true;
  if (/\d|-/.test(compact)) return true;
  if (compact.includes(canonical) || canonical.includes(compact)) return true;
  return containsWithinEditDistance(canonical, compact, 1);
}

/**
 * Finds an unambiguous model spelling that the customer explicitly typed in the
 * latest turn. This is deliberately exact (after the existing normalization),
 * latest-turn-only, and limited to variants owned by one synonym cluster.
 *
 * When a specific model contains a broader model name ("AVEO CNG" contains
 * "AVEO"), the longest evidence wins. If the turn really mentions two unrelated
 * vehicles ("Vios or Jazz"), no model is selected and the existing flow remains
 * untouched.
 */
export function resolveLatestExplicitCarModelEvidence(input: {
  latestText?: string | null;
  groundingLookup?: CarModelGroundingLookup | null;
}): ChatExplicitModelEvidence | null {
  const customerText = normalizeSearchText(input.latestText);
  const lookup = input.groundingLookup;
  if (!customerText || !lookup || lookup.size === 0) return null;

  const customerCompact = customerText.replace(/\s+/g, "");
  const customerTokens = new Set(tokenizeSearchVariants(customerText));
  const byCanonical = new Map<
    string,
    { canonicalModel: string; matchedEvidence: string; compactEvidence: string }
  >();

  for (const [canonicalKey, evidence] of lookup) {
    let best: { canonicalModel: string; matchedEvidence: string; compactEvidence: string } | null = null;
    for (const variant of evidence.safeVariants) {
      if (!isStructurallySafeModelEvidence(variant, canonicalKey)) continue;
      for (const spelling of buildSearchVariants(variant)) {
        const compact = spelling.replace(/\s+/g, "");
        // Very short Latin model names (IS/GS/HS) overlap ordinary English words.
        // They still resolve through the existing classifier path, but are never
        // allowed to override a different model without brand-scoped evidence.
        if (compact.length < 4) continue;
        if (!customerContainsExactModelSpelling(customerText, customerCompact, customerTokens, spelling)) continue;
        if (!best || compact.length > best.compactEvidence.length) {
          best = {
            canonicalModel: evidence.canonicalTerm,
            matchedEvidence: variant,
            compactEvidence: compact,
          };
        }
      }
    }
    if (best) byCanonical.set(canonicalKey, best);
  }

  const matches = Array.from(byCanonical.values()).sort(
    (a, b) => b.compactEvidence.length - a.compactEvidence.length,
  );
  const winner = matches[0];
  if (!winner) return null;

  // A shorter match is safe to ignore only when it is literally nested inside
  // the most-specific spelling (AVEO inside AVEO CNG). Independent mentions mean
  // the customer named multiple vehicles, so choosing either would be unsafe.
  if (
    matches.slice(1).some(
      (match) => !winner.compactEvidence.includes(match.compactEvidence),
    )
  ) {
    return null;
  }

  return {
    canonicalModel: winner.canonicalModel,
    matchedEvidence: winner.matchedEvidence,
  };
}

function resolveGroundingCanonicalKey(
  model: string | null | undefined,
  lookup?: CarModelGroundingLookup | null,
): string | null {
  const normalized = normalizeSearchText(model);
  if (!normalized || !lookup || lookup.size === 0) return null;
  if (lookup.has(normalized)) return normalized;
  const suffixMatches = Array.from(lookup.keys()).filter(
    (canonical) => canonical.length >= 3 && normalized.endsWith(` ${canonical}`),
  );
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}

/**
 * Candidate policy for Option B. This is intentionally SHADOW-ONLY: callers
 * observe what an every-turn hard-grounding policy would do, while the live intent
 * keeps today's behaviour until telemetry proves the candidate has no regression.
 */
export function evaluateChatModelGroundingCandidate(input: {
  model: string | null | undefined;
  carMentionInLatest?: string | null;
  latestText?: string | null;
  history: ChatReplyHistoryItem[];
  groundingLookup?: ReadonlyMap<
    string,
    { canonicalTerm?: string; safeVariants: string[]; ambiguousVariants: string[] }
  > | null;
}): Omit<ChatModelGroundingShadow, "currentModel" | "wouldChange"> | null {
  const rawModel = input.model?.trim();
  if (!rawModel) return null;

  const literal = lineValueHasCustomerEvidence(rawModel, input.latestText, input.history);
  if (literal) {
    return {
      evaluated: true,
      rawModel,
      candidateModel: rawModel,
      evidenceSource: "LITERAL_CANONICAL",
      matchedEvidence: rawModel,
      ambiguousVariantCount: 0,
    };
  }

  const lookup = input.groundingLookup;
  if (!lookup || lookup.size === 0) {
    return {
      evaluated: false,
      rawModel,
      candidateModel: rawModel,
      evidenceSource: "LOOKUP_UNAVAILABLE",
      matchedEvidence: null,
      ambiguousVariantCount: 0,
    };
  }

  const normalizedRawModel = normalizeSearchText(rawModel);
  let resolvedModelKey = normalizedRawModel;
  let evidence = lookup.get(resolvedModelKey);
  if (!evidence) {
    // Gemini occasionally prefixes a canonical model with the brand even though
    // `carBrand` is a separate field ("Nissan March" vs SearchSynonym "March").
    // Accept only one unambiguous canonical suffix; never fuzzy-match the model
    // key itself, which could turn a hallucinated near-name into a hard filter.
    const suffixMatches = Array.from(lookup.entries()).filter(
      ([canonical]) => canonical.length >= 3 && normalizedRawModel.endsWith(` ${canonical}`),
    );
    if (suffixMatches.length === 1) {
      [resolvedModelKey, evidence] = suffixMatches[0];
    }
  }
  const candidateModel = evidence?.canonicalTerm ?? (resolvedModelKey === normalizedRawModel ? rawModel : resolvedModelKey);
  const ambiguousVariantCount = evidence?.ambiguousVariants.length ?? 0;
  const safeVariants = (evidence?.safeVariants ?? []).filter((variant) =>
    isStructurallySafeModelEvidence(variant, resolvedModelKey),
  );
  const customerText = normalizeSearchText(
    [
      ...input.history.filter((turn) => turn.role === "customer").map((turn) => turn.text),
      input.latestText ?? "",
    ].join(" "),
  );
  const customerCompact = customerText.replace(/\s+/g, "");
  const customerTokens = new Set(tokenizeSearchVariants(customerText));

  for (const variant of safeVariants) {
    for (const spelling of buildSearchVariants(variant)) {
      const compact = spelling.replace(/\s+/g, "");
      if (!compact) continue;
      const exactToken = customerTokens.has(spelling);
      const safeSubstring = compact.length >= 4 && customerCompact.includes(compact);
      if (exactToken || safeSubstring) {
        return {
          evaluated: true,
          rawModel,
          candidateModel,
          evidenceSource: "SAFE_SYNONYM",
          matchedEvidence: variant,
          ambiguousVariantCount,
        };
      }
    }
  }

  const latestMention = input.carMentionInLatest?.trim() ?? "";
  if (latestMention && chatCarMentionOccursInLatest(latestMention, input.latestText)) {
    const mentionCompact = normalizeSearchText(latestMention).replace(/\s+/g, "");
    for (const variant of safeVariants) {
      const variantCompact = normalizeSearchText(variant).replace(/\s+/g, "");
      // Thai vowel/mark substitutions often count as two Unicode edits even when
      // a human sees one mistyped syllable ("คัมรี่" vs "แคมรี่"). This fallback
      // is gated by a verbatim latest-message mention and an unambiguous model
      // cluster, so two edits are acceptable for Thai while Latin stays at one.
      const maxMentionEdits = /[ก-๙]/.test(mentionCompact) ? 2 : 1;
      if (
        mentionCompact.length >= 4 &&
        variantCompact.length >= 4 &&
        containsWithinEditDistance(variantCompact, mentionCompact, maxMentionEdits)
      ) {
        return {
          evaluated: true,
          rawModel,
          candidateModel,
          evidenceSource: "LATEST_MENTION_TYPO",
          matchedEvidence: latestMention,
          ambiguousVariantCount,
        };
      }
    }
  }

  return {
    evaluated: true,
    rawModel,
    candidateModel: null,
    evidenceSource: "NO_EVIDENCE",
    matchedEvidence: null,
    ambiguousVariantCount,
  };
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
  /** Narrow, ambiguity-aware evidence lookup used by the every-turn SHADOW policy. */
  modelGroundingLookup?: CarModelGroundingLookup | null;
}) {
  const { intent, latestText, history, brandLookup, modelLookup, modelGroundingLookup } = input;
  if (!intent || !intent.isProductQuery) {
    return {
      intent,
      forceLiteralQuery: false,
      requiredTokens: [] as string[],
      modelGroundingShadow: null as ChatModelGroundingShadow | null,
    };
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

  const explicitModelEvidence = resolveLatestExplicitCarModelEvidence({
    latestText,
    groundingLookup: modelGroundingLookup,
  });
  const classifiedModelKey = resolveGroundingCanonicalKey(intent.carModel, modelGroundingLookup);
  const evidenceModelKey = normalizeSearchText(explicitModelEvidence?.canonicalModel);
  const modelEvidenceChanged = Boolean(
    intent.carModel &&
      explicitModelEvidence &&
      evidenceModelKey &&
      evidenceModelKey !== classifiedModelKey,
  );
  const reconciledModel =
    modelEvidenceChanged && explicitModelEvidence
      ? explicitModelEvidence.canonicalModel
      : intent.carModel;

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
    carModel:
      requiredTokens.length === 0
        ? reconciledModel
        : explicitModelEvidence
          ? reconciledModel
          : carModelGrounded
            ? intent.carModel
            : null,
    year: carYearGrounded ? intent.year : null,
  };
  const candidate = evaluateChatModelGroundingCandidate({
    model: intent.carModel,
    carMentionInLatest: intent.carMentionInLatest,
    latestText,
    history,
    groundingLookup: modelGroundingLookup,
  });
  const modelGroundingShadow: ChatModelGroundingShadow | null = candidate
    ? {
        ...candidate,
        currentModel: groundedIntent.carModel,
        wouldChange:
          candidate.evaluated &&
          normalizeSearchText(candidate.candidateModel) !== normalizeSearchText(groundedIntent.carModel),
      }
    : null;

  if (requiredTokens.length === 0) {
    // No model-code/year anchor to enforce a literal query, but the brand/year are
    // already grounded above so a hallucinated brand/year can't hard-filter here.
    return {
      intent: groundedIntent,
      // If the deterministic evidence corrected the classifier's model, its
      // generated query may still contain the wrong name. Searching the raw
      // customer text avoids a contradictory wrong-model query while the hard
      // fitment filter uses the corrected canonical model.
      forceLiteralQuery: modelEvidenceChanged,
      requiredTokens,
      modelGroundingShadow,
    };
  }

  const queryHasRequiredTokens = lineQueryContainsRequiredTokens(intent.query, requiredTokens);
  const forceLiteralQuery =
    modelEvidenceChanged || !queryHasRequiredTokens || !carBrandGrounded || !carModelGrounded;

  return {
    intent: groundedIntent,
    forceLiteralQuery,
    requiredTokens,
    modelGroundingShadow,
  };
}
