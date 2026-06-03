import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * Bot / keyboard-mashing detection for product-search telemetry.
 *
 * Goal: keep obvious junk out of the no-result quality report so genuine
 * customer misses are visible. Deliberately conservative — real Thai terms
 * ("คอมแอร์", "น้ำยา", "ผ้าเบรค") and part numbers ("P0032", "446610-1950")
 * must never be flagged. We only catch high-confidence noise.
 */

// Thai vowels, tone marks and signs. A genuine Thai term almost always carries
// at least one of these; a long run of bare consonants is keyboard mashing.
const THAI_VOWEL_OR_MARK = /[ะ-ฺเ-๎]/;
const THAI_CONSONANT = /[ก-ฮ]/;
const THAI_CHAR = /[฀-๿]/g;

// CJK ideographs + Japanese kana — irrelevant to a Thai auto-parts catalog, so
// such queries are scraper/bot noise.
const CJK_OR_KANA = /[぀-ヿ㐀-䶿一-鿿]/;

const MIN_MEANINGFUL_LENGTH = 2;
const MASH_MIN_LENGTH = 3;
const MASH_MAX_DISTINCT = 2;
const THAI_VOWELLESS_MIN_CHARS = 5;

export const isLikelyNoiseQuery = (rawQuery: string | null | undefined): boolean => {
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized) return true;

  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < MIN_MEANINGFUL_LENGTH) return true;

  // Foreign-script spam (Chinese / Japanese) — not part of this catalog.
  if (CJK_OR_KANA.test(compact)) return true;

  // Keyboard mashing: long-ish but only 1-2 distinct characters (e.g. "ddd").
  if (compact.length >= MASH_MIN_LENGTH && new Set(compact).size <= MASH_MAX_DISTINCT) {
    return true;
  }

  // Thai consonant runs with no vowel/tone mark at all (e.g. "กฟหกฟหก",
  // "ดกหดหกดดกหดหกด"). Only flag when dominated by bare Thai consonants and
  // long enough that a vowel-less real term would be implausible.
  if (THAI_CONSONANT.test(compact) && !THAI_VOWEL_OR_MARK.test(compact)) {
    const thaiCharCount = (compact.match(THAI_CHAR) ?? []).length;
    if (thaiCharCount >= THAI_VOWELLESS_MIN_CHARS && thaiCharCount >= compact.length - 1) {
      return true;
    }
  }

  return false;
};
