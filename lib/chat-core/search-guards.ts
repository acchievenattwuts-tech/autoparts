import { buildSearchVariants, normalizeSearchText, tokenizeSearchVariants } from "@/lib/search-normalization";
import type { ChatReplyHistoryItem, ChatSearchIntent } from "@/lib/chat-core/ai-service";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import { resolveBrandVariants } from "@/lib/chat-core/brand-variants";
import { containsWithinEditDistance, typoMaxEdits } from "@/lib/chat-core/typo-distance";
import type { CarModelGroundingLookup } from "@/lib/car-model-alias-cache";
import { extractChatEngineDisplacements } from "@/lib/chat-core/engine-displacement";
import {
  groundingClusterMembers,
  hasLatinLetters,
  hasThaiScript,
  isThaiOnlySpelling,
  rankVehicleMentionClusters,
} from "@/lib/chat-core/vehicle-mention-conflict";

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
 * The customer named a car in the latest message, and the classifier's model is
 * not supported by anything the customer wrote (incident 2026-10-20: "ซี๊ดตี้" read
 * as Fiesta). The model is dropped and the turn asks instead of searching.
 */
export type ChatVehicleMentionConflict = {
  /** The customer's own car words, verified to occur in the latest message. */
  mention: string;
  /** What the classifier returned for them (null when it returned no model but the
   *  customer has just rejected the car the shop proposed). */
  classifierModel: string | null;
  /** The one model the customer's words most likely mean, when a single cluster
   *  stands out; the caller asks the customer to confirm it. */
  suggestion: { canonicalModel: string; distance: number } | null;
};

/** A car the customer confirmed by answering "ใช่" to the shop's question. */
export type ChatConfirmedVehicle = {
  carBrand: string | null;
  carModel: string;
};

/**
 * Tokens with 3+ chars and a digit are usually model codes / part fragments in
 * LINE chats (e.g. 709, 2070, STA-7065). Keep them as required recall anchors so
 * a broad search fallback cannot drift to a popular but unrelated car model.
 */
export function extractChatRequiredSearchTokens(text?: string | null): string[] {
  const displacementCc = new Set(
    extractChatEngineDisplacements(text).map((displacement) => String(displacement.cc)),
  );
  return extractProductSearchRequiredTokens(text).filter((token) => {
    const numeric = token.match(/^(\d{3,4})(?:cc|ซีซี)?$/iu)?.[1];
    return !numeric || !displacementCc.has(numeric);
  });
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

/** Shortest known spelling accepted as the head of a longer classifier model
 *  ("mazda 2" in "Mazda 2 Skyactiv"). */
const MIN_MODEL_PREFIX_LENGTH = 3;

/** Splits a classifier value that lists several models ("Vigo, Revo"). */
const splitClassifierModelList = (model: string): string[] =>
  model
    .split(/\s*[,/|]\s*|\s+(?:และ|หรือ|กับ|and|or)\s+/iu)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * Maps a model spelling to its grounding-cluster key, or null when it belongs to no
 * known cluster. Tried in order: the canonical key itself, any synonym of a cluster
 * ("Vigo" → Hilux Vigo, "Mazda 2" → Mazda2), and finally the longest known spelling
 * that heads the value ("Mazda 2 Skyactiv" → Mazda2, "CR-V G3" → CRV). A head
 * shared by two clusters is ambiguous and yields null.
 */
function resolveGroundingClusterKey(
  model: string,
  modelLookup: ReadonlyMap<string, string[]>,
  groundingLookup: CarModelGroundingLookup,
): string | null {
  const normalized = normalizeSearchText(model);
  if (!normalized) return null;
  if (groundingLookup.has(normalized)) return normalized;

  const synonymCluster = modelLookup.get(normalized);
  const synonymKey = normalizeSearchText(synonymCluster?.[0]);
  if (synonymKey && groundingLookup.has(synonymKey)) return synonymKey;

  let longest = 0;
  let heads = new Set<string>();
  for (const [key, evidence] of groundingLookup) {
    for (const member of groundingClusterMembers(evidence)) {
      if (member.length < MIN_MODEL_PREFIX_LENGTH || !normalized.startsWith(`${member} `)) continue;
      if (member.length > longest) {
        longest = member.length;
        heads = new Set([key]);
      } else if (member.length === longest) {
        heads.add(key);
      }
    }
  }
  return heads.size === 1 ? Array.from(heads)[0] : null;
}

/** True when any spelling of the cluster occurs verbatim in the customer's text. */
function clusterHasCustomerSpellingEvidence(
  key: string,
  groundingLookup: CarModelGroundingLookup,
  latestText: string | null | undefined,
  history: ChatReplyHistoryItem[],
): boolean {
  const evidence = groundingLookup.get(key);
  if (!evidence) return false;
  const customerText = normalizeSearchText(
    [
      ...history.filter((turn) => turn.role === "customer").map((turn) => turn.text),
      latestText ?? "",
    ].join(" "),
  );
  if (!customerText) return false;
  const customerCompact = customerText.replace(/\s+/g, "");
  const customerTokens = new Set(tokenizeSearchVariants(customerText));
  return groundingClusterMembers(evidence).some((member) =>
    buildSearchVariants(member).some((spelling) =>
      customerContainsExactModelSpelling(customerText, customerCompact, customerTokens, spelling),
    ),
  );
}

/**
 * Decides whether the classifier's model contradicts the car the customer named in
 * the latest message. Fails open (returns null) whenever it cannot judge: no
 * verified mention, no synonym data, a model with no known spellings, or a model
 * whose known spellings are all in a different script from the customer's words
 * (a Thai "กอล์ฟ" says nothing about a cluster that only lists "Golf").
 *
 * A model is supported — never a conflict — when the existing evidence checks
 * already grounded it, when any of its known spellings occurs in the customer's
 * text (history included, so a model carried from an earlier turn stays), or when
 * the customer's words are a typo of it (it is among the closest clusters).
 */
function assessChatVehicleMentionConflict(input: {
  model: string;
  mention: string | null | undefined;
  latestText: string | null | undefined;
  history: ChatReplyHistoryItem[];
  modelGrounded: boolean;
  modelLookup: ReadonlyMap<string, string[]> | null | undefined;
  groundingLookup: CarModelGroundingLookup | null | undefined;
}): ChatVehicleMentionConflict | null {
  const mention = input.mention?.trim();
  if (!mention || input.modelGrounded || !chatCarMentionOccursInLatest(mention, input.latestText)) return null;
  const { modelLookup, groundingLookup } = input;
  if (!modelLookup || modelLookup.size === 0 || !groundingLookup || groundingLookup.size === 0) return null;

  const knownKeys = Array.from(
    new Set(
      splitClassifierModelList(input.model)
        .map((part) => resolveGroundingClusterKey(part, modelLookup, groundingLookup))
        .filter((key): key is string => key !== null),
    ),
  );
  const mentionIsThai = hasThaiScript(mention);
  const judgeableKeys = knownKeys.filter((key) => {
    const members = groundingClusterMembers(groundingLookup.get(key) ?? { safeVariants: [], ambiguousVariants: [] });
    return mentionIsThai ? members.some(isThaiOnlySpelling) : members.some(hasLatinLetters);
  });
  if (judgeableKeys.length === 0) return null;

  const withoutSpelling = judgeableKeys.filter(
    (key) => !clusterHasCustomerSpellingEvidence(key, groundingLookup, input.latestText, input.history),
  );
  if (withoutSpelling.length === 0) return null;

  const ranking = rankVehicleMentionClusters(mention, groundingLookup);
  const unsupported = withoutSpelling.filter((key) => !ranking?.keys.includes(key));
  if (unsupported.length === 0) return null;

  const suggestionKey =
    ranking && ranking.keys.length === 1 && !knownKeys.includes(ranking.keys[0]) ? ranking.keys[0] : null;
  const suggestionTerm = suggestionKey ? groundingLookup.get(suggestionKey)?.canonicalTerm : null;
  return {
    mention,
    classifierModel: input.model,
    suggestion: suggestionTerm && ranking ? { canonicalModel: suggestionTerm, distance: ranking.distance } : null,
  };
}

/**
 * Reads the car label of a confirmation question the customer answered "ใช่" to
 * ("Honda City", "Toyota Hilux Vigo", or a bare "City" when no brand resolved).
 * The model maps to its canonical term through the synonym data; without it the
 * label is passed on whole for the fitment resolver to read.
 */
function resolveConfirmedChatVehicle(
  label: string,
  modelLookup: ReadonlyMap<string, string[]> | null | undefined,
  groundingLookup: CarModelGroundingLookup | null | undefined,
): ChatConfirmedVehicle | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  if (modelLookup && modelLookup.size > 0 && groundingLookup && groundingLookup.size > 0) {
    const tokens = trimmed.split(/\s+/);
    const readings: Array<[string | null, string]> = [
      [tokens.length > 1 ? tokens[0] : null, tokens.slice(1).join(" ")],
      [null, trimmed],
    ];
    for (const [brand, modelText] of readings) {
      if (!modelText) continue;
      const key = resolveGroundingClusterKey(modelText, modelLookup, groundingLookup);
      const canonical = key ? groundingLookup.get(key)?.canonicalTerm : null;
      if (canonical) return { carBrand: brand, carModel: canonical };
    }
  }
  return { carBrand: null, carModel: trimmed };
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
  /** Narrow, ambiguity-aware evidence lookup used by the every-turn SHADOW policy
   *  and by the vehicle-mention conflict check. */
  modelGroundingLookup?: CarModelGroundingLookup | null;
  /** The customer's bare answer to the shop's "หมายถึง <car> ใช่ไหมคะ": "confirmed"
   *  makes `vehicleLabel` the car; "rejected" leaves the car unknown so the turn asks. */
  vehicleConfirmation?: { kind: "confirmed" | "rejected"; mention: string; vehicleLabel: string } | null;
}) {
  const { intent, latestText, history, brandLookup, modelLookup, modelGroundingLookup, vehicleConfirmation } = input;
  if (!intent || !intent.isProductQuery) {
    return {
      intent,
      forceLiteralQuery: false,
      requiredTokens: [] as string[],
      modelGroundingShadow: null as ChatModelGroundingShadow | null,
      vehicleMentionConflict: null as ChatVehicleMentionConflict | null,
      confirmedVehicle: null as ChatConfirmedVehicle | null,
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
  let groundedIntent: ChatSearchIntent = {
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

  // The customer answered "ใช่" to "หมายถึง <car> ใช่ไหมคะ": that car is grounded by
  // the answer, not by the customer's spelling, so it replaces whatever the
  // classifier read (it may repeat the misreading the question was about).
  const confirmedVehicle =
    vehicleConfirmation?.kind === "confirmed"
      ? resolveConfirmedChatVehicle(vehicleConfirmation.vehicleLabel, modelLookup, modelGroundingLookup)
      : null;
  const confirmedModelChanged = Boolean(
    confirmedVehicle &&
      normalizeSearchText(confirmedVehicle.carModel) !== normalizeSearchText(intent.carModel),
  );
  if (confirmedVehicle) {
    groundedIntent = {
      ...groundedIntent,
      carBrand: confirmedVehicle.carBrand ?? groundedIntent.carBrand,
      carModel: confirmedVehicle.carModel,
      carMentionInLatest: null,
    };
  }

  // The model is otherwise only grounded when a required token is present (see
  // above). That let a classifier misreading straight through on a plain Thai turn —
  // "คอยเย็นซี๊ดตี้09" became Ford Fiesta (incident 2026-10-20). When the customer
  // named a car in THIS message and nothing they wrote supports the classifier's
  // model, drop the model so the turn asks instead of answering for another car.
  // A bare "ไม่ใช่" to that question: whatever the classifier reads now (often the
  // car the shop itself proposed), the customer has said it is wrong — ask instead.
  const vehicleMentionConflict: ChatVehicleMentionConflict | null =
    vehicleConfirmation?.kind === "rejected"
      ? { mention: vehicleConfirmation.mention, classifierModel: intent.carModel, suggestion: null }
      : !confirmedVehicle && !explicitModelEvidence && groundedIntent.carModel
        ? assessChatVehicleMentionConflict({
            model: groundedIntent.carModel,
            mention: intent.carMentionInLatest,
            latestText,
            history,
            modelGrounded: carModelGrounded,
            modelLookup,
            groundingLookup: modelGroundingLookup,
          })
        : null;
  if (vehicleMentionConflict) {
    groundedIntent = { ...groundedIntent, carModel: null };
  }

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
      // fitment filter uses the corrected canonical model. A confirmed car replaces
      // the classifier's model the same way.
      forceLiteralQuery: modelEvidenceChanged || confirmedModelChanged,
      requiredTokens,
      modelGroundingShadow,
      vehicleMentionConflict,
      confirmedVehicle,
    };
  }

  const queryHasRequiredTokens = lineQueryContainsRequiredTokens(intent.query, requiredTokens);
  const forceLiteralQuery =
    modelEvidenceChanged ||
    confirmedModelChanged ||
    !queryHasRequiredTokens ||
    !carBrandGrounded ||
    (!carModelGrounded && !confirmedVehicle);

  return {
    intent: groundedIntent,
    forceLiteralQuery,
    requiredTokens,
    modelGroundingShadow,
    vehicleMentionConflict,
    confirmedVehicle,
  };
}
