import { normalizeSearchText } from "@/lib/search-normalization";
import { osaDistance, typoMaxEdits } from "@/lib/chat-core/typo-distance";
import { findCarBrandMentions } from "@/lib/chat-core/brand-variants";
import type { CarModelGroundingLookup } from "@/lib/car-model-alias-cache";
import type { ChatReplyHistoryItem } from "@/lib/chat-core/ai-service";

/**
 * The customer named a car in their own words, and the classifier returned a model
 * those words do not support (incident 2026-10-20: "คอยเย็นซี๊ดตี้09" — a Honda City —
 * came back as Ford Fiesta and the customer was shown Mazda 2 / Fiesta evaporators).
 *
 * This module holds the pure pieces of the fix, shared by LINE and Messenger:
 *  - a typo-tolerant ranking of the customer's car words against every known model
 *    spelling, used both to accept a mis-keyed spelling of the classifier's own
 *    model and to propose the model the customer probably meant;
 *  - the จูน-voiced confirmation question ("หมายถึง Honda City ใช่ไหมคะ") and the
 *    plain "which car?" ask used when no single model stands out;
 *  - reading the customer's bare "ใช่" / "ไม่ใช่" on the next turn and replaying the
 *    original question — with the confirmed car, or asking which car.
 *
 * Nothing here reads the database; callers pass the cached synonym lookups in.
 */

/** Thai tone marks and signs written above/below a consonant (็ ่ ้ ๊ ๋ ์ ํ ๎).
 *  Customers drop, add or swap them freely ("ซี๊ดตี้" for "ซิตี้"), and each would
 *  otherwise cost a full edit — two of them already exhaust the edit budget. */
const THAI_TONE_AND_SIGN_RE = /[็-๎]/g;
const THAI_CHAR_RE = /[฀-๿]/;
const LATIN_LETTER_RE = /[a-z]/i;
/** Thai vowels written BEFORE the consonant they follow in speech (เ แ โ ใ ไ). */
const THAI_LEADING_VOWEL_RE = /^[เ-ไ]/;

/** Shortest spelling an exact containment may match: below four characters a
 *  spelling occurs inside unrelated words ("อาย", "fit"). */
const MIN_CONTAINED_SPELLING_LENGTH = 4;
/** Shortest model word compared approximately ("มาส" for "มาช"/"มาร์ช"). */
const MIN_TYPO_CORE_LENGTH = 3;
/** Edit budget for a Thai model word of four or more letters once tone marks are
 *  folded: a mis-keyed syllable is often two edits ("ซีดตี" vs "ซิตี" — a vowel
 *  swap plus a doubled consonant). Three-letter words get one. */
const THAI_TYPO_MAX_EDITS = 2;
const THAI_SHORT_WORD_LENGTH = 3;
/** Shortest Latin model word compared approximately. */
const MIN_LATIN_TYPO_CORE_LENGTH = 4;
/** Brand spellings customers and the synonym table use that the shared brand map
 *  lacks. Removed before an approximate comparison, like the mapped ones. */
const EXTRA_BRAND_SPELLINGS = ["นิสัน", "อีซูสุ", "มิซูบิชิ", "มาสดา", "เชฟโรเลท", "ฟอด", "ฮุนได", "โฟล์ค", "โฟล์ก", "เบนซ์"];
const MAX_QUOTED_MENTION_LENGTH = 30;
/** How many customer messages before the confirmation question are replayed. */
const MAX_REPLAY_CUSTOMER_TURNS = 5;

export const hasThaiScript = (value: string | null | undefined): boolean => THAI_CHAR_RE.test(value ?? "");

/** A spelling written in Thai script only (it may carry digits, never Latin letters). */
export const isThaiOnlySpelling = (value: string | null | undefined): boolean =>
  hasThaiScript(value) && !LATIN_LETTER_RE.test(value ?? "");

export const hasLatinLetters = (value: string | null | undefined): boolean => LATIN_LETTER_RE.test(value ?? "");

/** Normalizes a vehicle spelling for approximate comparison: search normalization,
 *  no whitespace, no Thai tone marks. */
export const foldVehicleSpelling = (value: string | null | undefined): string =>
  normalizeSearchText(value).replace(/\s+/g, "").replace(THAI_TONE_AND_SIGN_RE, "");

/**
 * The model word alone: brand spellings and digits removed, then folded. "ฮอนด้าซี๊ดตี้09"
 * and "ซี๊ดตี้" both become "ซีดตี"; "นิสสันมาร์ช" becomes "มารช". Pure + exported for
 * unit testing.
 */
export function vehicleModelCore(value: string | null | undefined): string {
  let text = normalizeSearchText(value);
  const brands = findCarBrandMentions(text).sort((a, b) => b.start - a.start);
  for (const brand of brands) text = `${text.slice(0, brand.start)} ${text.slice(brand.end)}`;
  for (const spelling of EXTRA_BRAND_SPELLINGS) text = text.split(spelling).join(" ");
  return foldVehicleSpelling(text).replace(/\d+/g, "");
}

/** First letter that carries the word's sound: a Thai leading vowel is skipped. */
const anchorLetter = (core: string): string => core.replace(THAI_LEADING_VOWEL_RE, "").charAt(0);

/** Edit budget for an approximate comparison of two model words, or null when the
 *  word is too short to compare at all. */
function typoBudget(core: string): number | null {
  if (hasThaiScript(core)) {
    if (core.length < MIN_TYPO_CORE_LENGTH) return null;
    return core.length <= THAI_SHORT_WORD_LENGTH ? 1 : THAI_TYPO_MAX_EDITS;
  }
  return core.length < MIN_LATIN_TYPO_CORE_LENGTH ? null : typoMaxEdits(core.length);
}

/**
 * Edit distance between the customer's model word and a known spelling's model
 * word, or null when they are not close. Whole words are compared, never a window
 * inside a longer text — a sliding window lets a four-letter name match almost
 * any Thai syllables ("ซีดตี" contains something two edits from "ฟรีด" and "ทีดา").
 * The first sounded letter must agree: customers mis-key vowels and doubled
 * consonants, rarely the opening consonant. Pure + exported for unit testing.
 */
export function vehicleModelTypoDistance(mentionCore: string, spellingCore: string): number | null {
  const budget = typoBudget(spellingCore);
  if (budget === null || typoBudget(mentionCore) === null) return null;
  if (anchorLetter(mentionCore) !== anchorLetter(spellingCore)) return null;
  if (Math.abs(mentionCore.length - spellingCore.length) > budget) return null;
  const distance = osaDistance(mentionCore, spellingCore);
  return distance <= budget ? distance : null;
}

/** Every spelling a grounding cluster knows: canonical term, safe and shared ones. */
export const groundingClusterMembers = (
  evidence: { canonicalTerm?: string; safeVariants: string[]; ambiguousVariants: string[] },
): string[] =>
  Array.from(
    new Set(
      [evidence.canonicalTerm ?? "", ...evidence.safeVariants, ...evidence.ambiguousVariants]
        .map((value) => normalizeSearchText(value))
        .filter(Boolean),
    ),
  );

type PreparedCluster = { key: string; spellings: Array<{ folded: string; core: string }> };

/** Folded spellings and model cores per lookup instance. The loader caches one
 *  lookup for a minute, so this work is done once per lookup, not per turn. */
const preparedClusterCache = new WeakMap<CarModelGroundingLookup, PreparedCluster[]>();

function preparedClusters(lookup: CarModelGroundingLookup): PreparedCluster[] {
  const cached = preparedClusterCache.get(lookup);
  if (cached) return cached;
  const prepared = Array.from(lookup, ([key, evidence]) => ({
    key,
    spellings: groundingClusterMembers(evidence).map((member) => ({
      folded: foldVehicleSpelling(member),
      core: vehicleModelCore(member),
    })),
  }));
  preparedClusterCache.set(lookup, prepared);
  return prepared;
}

export type VehicleMentionClusterRanking = {
  /** Grounding-lookup keys of every cluster tied at the best distance. */
  keys: string[];
  distance: number;
};

/**
 * Ranks every known model cluster against the customer's car words and returns
 * the clusters tied at the best distance, or null when none is close.
 *
 *  1. Exact: a known spelling of four or more letters occurs in the words, tone
 *     marks and spaces ignored ("นิสันเออแวนe26" contains "เออแวน") → distance 0.
 *  2. Otherwise a typo: the words' model core (brand and digits removed) against
 *     each spelling's core, see {@link vehicleModelTypoDistance}.
 *
 * Shared spellings ("ปาเจโร่" belongs to Pajero and Pajero Sport) are ranked too:
 * a tie is reported as a tie, and callers never pick a single model out of one.
 */
export function rankVehicleMentionClusters(
  mention: string | null | undefined,
  lookup: CarModelGroundingLookup | null | undefined,
): VehicleMentionClusterRanking | null {
  const haystack = foldVehicleSpelling(mention);
  if (!haystack || !lookup || lookup.size === 0) return null;
  const mentionCore = vehicleModelCore(mention);

  const exact: string[] = [];
  const typo = new Map<string, number>();
  for (const cluster of preparedClusters(lookup)) {
    let clusterTypo: number | null = null;
    let contained = false;
    for (const spelling of cluster.spellings) {
      if (spelling.folded.length >= MIN_CONTAINED_SPELLING_LENGTH && haystack.includes(spelling.folded)) {
        contained = true;
        break;
      }
      const distance = mentionCore ? vehicleModelTypoDistance(mentionCore, spelling.core) : null;
      if (distance !== null && (clusterTypo === null || distance < clusterTypo)) clusterTypo = distance;
    }
    if (contained) exact.push(cluster.key);
    else if (clusterTypo !== null) typo.set(cluster.key, clusterTypo);
  }
  if (exact.length > 0) return { keys: exact, distance: 0 };
  if (typo.size === 0) return null;

  const best = Math.min(...typo.values());
  return { keys: Array.from(typo.entries()).filter(([, d]) => d === best).map(([key]) => key), distance: best };
}

// ── จูน-voiced messages ──────────────────────────────────────────────────────

const CONFIRM_PROMPT_LEAD = "จูนขอเช็กรุ่นรถให้ชัวร์ก่อนนะคะ 🙏";
const CONFIRM_PROMPT_RE =
  /จูนขอเช็กรุ่นรถให้ชัวร์ก่อนนะคะ 🙏 "([^"\n]{1,40})" หมายถึง ([^\n]{1,60}?) ใช่ไหมคะ/u;

/** The customer's words as they are quoted back: one line, no quotes, bounded. */
const quoteMention = (mention: string): string =>
  mention.replace(/["“”\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUOTED_MENTION_LENGTH);

/**
 * Asks the customer to confirm the one model their words most likely mean. The
 * first line is machine-readable on purpose: {@link parseChatVehicleConfirmPrompt}
 * reads it back from history when the customer answers "ใช่".
 */
export function buildChatVehicleConfirmPrompt(input: { mention: string; vehicleLabel: string }): string {
  return [
    `${CONFIRM_PROMPT_LEAD} "${quoteMention(input.mention)}" หมายถึง ${input.vehicleLabel.trim()} ใช่ไหมคะ`,
    'ถ้าใช่ ตอบ "ใช่" ได้เลยค่ะ ถ้าไม่ใช่ รบกวนพิมพ์ยี่ห้อ/รุ่นรถอีกครั้งนะคะ 🚗',
  ].join("\n");
}

/** Reads a confirmation question this module wrote; null for any other message. */
export function parseChatVehicleConfirmPrompt(
  text: string | null | undefined,
): { mention: string; vehicleLabel: string } | null {
  const match = text?.match(CONFIRM_PROMPT_RE);
  if (!match) return null;
  const mention = match[1].trim();
  const vehicleLabel = match[2].trim();
  return mention && vehicleLabel ? { mention, vehicleLabel } : null;
}

/** Asked when the customer's car words fit no single model. Never a hand-off: the
 *  AI stays active and searches as soon as the customer names the car again. */
export function buildChatVehicleMentionAskReply(mention: string): string {
  return `จูนยังไม่แน่ใจว่า "${quoteMention(mention)}" หมายถึงรถรุ่นไหนค่ะ 🙏 รบกวนแจ้งยี่ห้อ/รุ่นรถอีกครั้งนะคะ (เช่น Honda City, Toyota Vios) จะได้หาอะไหล่ให้ตรงรุ่นค่ะ 🚗`;
}

// ── Reading the customer's answer ────────────────────────────────────────────

const AFFIRMATIVE_HEADS = [
  "ใช่แล้ว",
  "ใช่",
  "ใช้",
  "ช่าย",
  "ชั่ย",
  "ถูกต้อง",
  "ถูก",
  "ตามนั้น",
  "แม่น",
  "โอเคร",
  "โอเค",
  "okay",
  "ok",
  "yes",
  "yep",
  "เค",
  "ครับ",
  "คับ",
  "ค่ะ",
  "คะ",
  "ค่า",
  "จ้า",
  "จ้ะ",
  "อืม",
  "อือ",
  "ฮะ",
  "ค้าบ",
  "คร้าบ",
  "ครัช",
  "คัฟ",
].sort((a, b) => b.length - a.length);

const POLITE_TAILS = [
  "ครับ",
  "คับ",
  "ค่ะ",
  "คะ",
  "ค่า",
  "จ้า",
  "จ้ะ",
  "จ๊ะ",
  "นะ",
  "ฮะ",
  "ค้าบ",
  "คร้าบ",
  "คร๊าบ",
  "ครัช",
  "คัฟ",
  "แล้ว",
  "ผม",
].sort((a, b) => b.length - a.length);

const NEGATIVE_HEADS = ["ไม่ใช่", "ไม่ใช้", "ไม่ช่าย", "ไม่ถูก", "ผิด", "nope", "no", "ไม่"].sort(
  (a, b) => b.length - a.length,
);
/** Words a bare "no" may end with besides politeness ("ไม่ใช่รุ่นนี้ครับ"). */
const NEGATIVE_TAILS = [...POLITE_TAILS, "รุ่นนี้", "ตัวนี้", "คันนี้"].sort((a, b) => b.length - a.length);

const ANSWER_NOISE_RE = /[\s.!?,~^'"“”ๆ]+|\p{Extended_Pictographic}|️/gu;

/** True when the line is exactly one of `heads` followed only by `tails`. */
function isBareAnswerLine(line: string, heads: string[], tails: string[], forbidden?: string): boolean {
  const compact = normalizeSearchText(line).replace(ANSWER_NOISE_RE, "");
  if (!compact || (forbidden && compact.includes(forbidden))) return false;
  const head = heads.find((candidate) => compact.startsWith(candidate));
  if (!head) return false;
  let rest = compact.slice(head.length);
  while (rest) {
    const tail = tails.find((candidate) => rest.startsWith(candidate));
    if (!tail) return false;
    rest = rest.slice(tail.length);
  }
  return true;
}

const everyLine = (text: string | null | undefined, test: (line: string) => boolean): boolean => {
  const lines = (text ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every(test);
};

/**
 * True when EVERY line of the message is a bare yes ("ใช่", "ใช่คับ", "ครับผม",
 * "โอเคค่ะ 🙏"). Anything else — a negation, a car name, a question — is left to the
 * normal classifier, which sees the confirmation question in history.
 */
export function isChatAffirmativeReply(text: string | null | undefined): boolean {
  return everyLine(text, (line) => isBareAnswerLine(line, AFFIRMATIVE_HEADS, POLITE_TAILS, "ไม่"));
}

/**
 * True when EVERY line is a bare no ("ไม่ใช่", "ไม่ใช่ครับ", "ผิดค่ะ", "ไม่ใช่รุ่นนี้").
 * A no that names the right car ("ไม่ใช่ครับ ซีวิค") is NOT bare — the classifier
 * reads that car through the normal pipeline.
 */
export function isChatNegativeReply(text: string | null | undefined): boolean {
  const isNo = (line: string) => isBareAnswerLine(line, NEGATIVE_HEADS, NEGATIVE_TAILS);
  // A burst may close with a separate "ครับ" ("ไม่ใช่" + "ครับ").
  return everyLine(text, (line) => isNo(line) || isPoliteOnlyLine(line)) && !isPoliteOnlyReply(text);
}

const isPoliteOnlyLine = (line: string): boolean => isBareAnswerLine(line, POLITE_TAILS, POLITE_TAILS);

/** "ครับ", "ค่ะ 🙏" — politeness alone, part of whichever answer it follows. */
const isPoliteOnlyReply = (text: string | null | undefined): boolean => everyLine(text, isPoliteOnlyLine);

/** Placeholder history text for a non-text message (see toReplyHistory on LINE). */
const HISTORY_PLACEHOLDER_RE = /^\[(?:รูปภาพ|สติกเกอร์|ข้อความ)\]$/u;

export type ChatVehicleConfirmationReplay = {
  /** "confirmed" for a bare yes, "rejected" for a bare no. */
  kind: "confirmed" | "rejected";
  mention: string;
  vehicleLabel: string;
  /** The customer's message(s) that the confirmation question was about. */
  originalText: string;
  /** What the pipeline processes instead of the bare answer: the original question,
   *  followed by the confirmed car on a yes. On a no the car stays unknown and the
   *  turn asks which car (the caller forces that). */
  replayText: string;
};

/**
 * Recognises "the shop's last message was our confirmation question and the
 * customer answered with a bare yes or no". Returns the original question (plus the
 * confirmed car on a yes) so the caller can run the normal pipeline on it; null in
 * every other case — a no that names the right car, a new question — which the
 * normal classifier handles with the question in history.
 *
 * `history` is oldest → newest and may already contain this burst's own messages
 * (Messenger stores them before replying), so customer messages after the question
 * are accepted only when they are the same kind of bare answer.
 */
export function resolveChatVehicleConfirmationReplay(input: {
  latestText: string | null | undefined;
  history: ChatReplyHistoryItem[];
}): ChatVehicleConfirmationReplay | null {
  const kind = isChatAffirmativeReply(input.latestText)
    ? "confirmed"
    : isChatNegativeReply(input.latestText)
      ? "rejected"
      : null;
  if (!kind) return null;
  const sameAnswer = (text: string) =>
    kind === "confirmed" ? isChatAffirmativeReply(text) : isChatNegativeReply(text) || isPoliteOnlyReply(text);

  const { history } = input;
  let promptIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn.role === "shop") {
      promptIndex = index;
      break;
    }
    if (!sameAnswer(turn.text)) return null;
  }
  if (promptIndex < 0) return null;

  const prompt = parseChatVehicleConfirmPrompt(history[promptIndex].text);
  if (!prompt) return null;

  const asked: string[] = [];
  for (
    let index = promptIndex - 1;
    index >= 0 && history[index].role === "customer" && asked.length < MAX_REPLAY_CUSTOMER_TURNS;
    index -= 1
  ) {
    const text = history[index].text.trim();
    if (text && !HISTORY_PLACEHOLDER_RE.test(text)) asked.unshift(text);
  }
  const originalText = asked.join("\n");
  if (!originalText) return null;

  return {
    kind,
    mention: prompt.mention,
    vehicleLabel: prompt.vehicleLabel,
    originalText,
    replayText: kind === "confirmed" ? `${originalText}\n${prompt.vehicleLabel}` : originalText,
  };
}
