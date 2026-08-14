/**
 * Thai typing-slip handling. TWO functions with deliberately different contracts —
 * mixing them up produces the exact bug this module was written to avoid.
 *
 *  1. {@link foldThaiSpelling} — LOSSY and SYMMETRIC. Strips tone marks and other
 *     droppable accents so two spellings can be COMPARED IN MEMORY. Only valid when
 *     BOTH sides are folded. Its output is not real Thai and must NEVER be sent to
 *     the product search: the search index stores raw catalog text, so a folded
 *     query is matched against unfolded data and scores WORSE than the original.
 *     (Measured: "ท่อยางหม้อน้ำ" folded to "ทอยางหมอนำ" returns 0 against a catalog
 *     where the correct spelling returns 127.)
 *
 *  2. {@link repairThaiTyping} — NON-LOSSY REPAIR. Turns a mistyped string into the
 *     correctly-spelled one, so the result is ordinary Thai that matches the raw
 *     index. This is the only variant safe to re-query with.
 *
 * Neither belongs in {@link ../search-normalization}. That module's
 * `normalizeSearchText` / `buildSearchVariants` feed the evidence guards
 * (`lineValueHasCustomerEvidence`, `lineQueryContainsRequiredTokens`) and the
 * product-search required-token machinery, where widening what counts as "equal"
 * makes the guards LOOSER — a hallucinated brand would start passing evidence, and
 * a required code anchor would start matching a different code. Folding belongs on
 * the RECALL side only, where the worst case is "found nothing extra".
 *
 * What it folds, and why each one is a real customer typing slip:
 *  - ` ํา` (nikhahit + sara aa) → `ำ`: renders IDENTICALLY to sara am but is a
 *    different code point, so an otherwise perfect word silently fails to match.
 *  - tone marks (่ ้ ๊ ๋), thanthakhat (์), maitaikhu (็), phinthu (ฺ), yamakkan (๎):
 *    the single most common Thai omission ("วีโก" for "วีโก้", "คอยล" for "คอยล์").
 *  - `ๆ` / `ฯ`: repetition/abbreviation marks that carry no lexical content.
 *  - a run of 3+ identical characters → one ("คอมมมแอร์" → "คอมแอร์"): keyboard
 *    repeat / emphasis. A run of exactly 2 is LEFT ALONE because real Thai words
 *    contain doubled letters ("นกกระ", "จัดดี"), and folding those would merge
 *    genuinely different words.
 *
 * Latin text is only lowercased and whitespace-collapsed here — Latin part codes
 * ("R134a", "STA-7065") must never be folded, and their typo handling already
 * lives in the trigram/required-token layers.
 */

// Combining marks are written as \u escapes on purpose: they render as invisible
// or as a stray floating accent in an editor, so a literal form here would be
// impossible to review and trivially corrupted by a careless edit. The readable
// Thai-text rule targets customer-facing strings, not invisible diacritics.

/**
 * Marks that ride ABOVE/BELOW a base character and are routinely dropped when
 * typing fast: mai ek/tho/tri/chattawa (U+0E48–U+0E4B), thanthakhat (U+0E4C),
 * maitaikhu (U+0E47), phinthu (U+0E3A), yamakkan (U+0E4E).
 * Sara vowels (U+0E34–U+0E39) are NOT here — dropping those changes the word.
 * Nikhahit (U+0E4D) is NOT here either — it is handled below, because it is half
 * of a real vowel rather than a droppable accent.
 */
const THAI_DIACRITICS = /[่-์็ฺ๎]/g;
/**
 * Sara am (U+0E33 ำ) typed as nikhahit (U+0E4D) + sara aa (U+0E32 า) — renders
 * identically, different code points, so an otherwise perfect word fails to match.
 *
 * This MUST run AFTER {@link THAI_DIACRITICS}: in real text a tone mark sits
 * BETWEEN the two halves (น + ํ + ้ + า for what should be น + ้ + ำ), so matching
 * the pair directly on the raw string misses the most common occurrence — the
 * word น้ำ itself. Stripping tone marks first makes the two halves adjacent.
 */
const NIKHAHIT_SARA_AA = /ํา/g;
/** A nikhahit left over without its sara aa carries no distinguishing value. */
const ORPHAN_NIKHAHIT = /ํ/g;
/** Repetition (mai yamok U+0E46) and abbreviation (paiyannoi U+0E2F) marks. */
const THAI_STRUCTURAL_MARKS = /[ๆฯ]/g;
const ZERO_WIDTH = /[​-‍﻿]/g;
/** Three or more of the SAME character collapse to one (see module note). */
const TRIPLED_CHARACTER = /(.)\1{2,}/gu;

/**
 * Folds one string to its typo-tolerant form. Idempotent: folding a folded value
 * returns the same value.
 */
export const foldThaiSpelling = (value?: string | null): string => {
  if (!value) return "";
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(ZERO_WIDTH, "")
    .replace(THAI_DIACRITICS, "")
    .replace(NIKHAHIT_SARA_AA, "ำ")
    .replace(ORPHAN_NIKHAHIT, "")
    .replace(THAI_STRUCTURAL_MARKS, "")
    .replace(TRIPLED_CHARACTER, "$1")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Sara am typed as its two halves, with an optional tone mark on EITHER side of the
 * nikhahit — both orders occur, depending on keystroke order. The captured tone
 * marks are re-emitted BEFORE the recomposed ำ, which is the canonical order.
 */
const DECOMPOSED_SARA_AM = /([่-๋]?)ํ([่-๋]?)า/g;
/** A run of three or more identical characters. */
const TRIPLED_RUN = /(.)\1{2,}/gu;

/**
 * Repairs a mistyped Thai string into its correctly-spelled form. Unlike
 * {@link foldThaiSpelling} this is NON-LOSSY: tone marks, vowels and case are all
 * preserved, so the output is ordinary Thai that can be matched against the raw
 * catalog index.
 *
 * It repairs exactly the two slips the search engine's trigram layer provably
 * cannot bridge on its own:
 *
 *  1. `ํา` (nikhahit + sara aa) written where `ำ` was meant. One visually identical
 *     character becomes two code points, which shifts EVERY trigram spanning that
 *     position at once — the customer sees a word that looks perfectly spelled.
 *  2. A run of 3+ identical characters ("คอมมมแอร์"), which pads the string and
 *     drops similarity below the floor.
 *
 * A plain DROPPED tone mark is deliberately not repaired — it cannot be, without
 * guessing which mark was meant, and the engine already recovers those on its own
 * (PLAN.md 2026-08-03 measured "ไดรเออร์ ↔ ไดเออร์" at 100% via trigram alone).
 */
export const repairThaiTyping = (value?: string | null): string => {
  if (!value) return "";
  return value
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(DECOMPOSED_SARA_AM, "$1$2ำ")
    .replace(TRIPLED_RUN, "$1")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * True when {@link repairThaiTyping} would actually change the text — i.e. there is
 * a real slip to repair and a retry is worth an extra query. Ordinary, correctly
 * typed text returns false, so no normal turn pays for the recovery.
 */
export const needsThaiTypingRepair = (value?: string | null): boolean => {
  const original = (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return Boolean(original) && repairThaiTyping(value) !== original;
};

/**
 * True when two strings are the same word once folded. Used by the intent
 * hard-guard so "โอนแล้ว" and "โอนแลว" are one keyword, without either side
 * needing its own dictionary entry.
 */
export const foldedThaiEquals = (a?: string | null, b?: string | null): boolean => {
  const left = foldThaiSpelling(a);
  return Boolean(left) && left === foldThaiSpelling(b);
};
