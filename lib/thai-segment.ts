import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * Thai word segmentation for search precision (Phase A-light).
 *
 * Thai is written without spaces, so a compound query like "น้ำยาล้างคอยเย็น"
 * arrives as a single whitespace token — which means the AND-across-concepts
 * precision path never engages for Thai. We use the built-in ICU dictionary
 * segmenter (Intl.Segmenter, full-ICU shipped with Node 18+) to split a Thai run
 * into its words, then feed those words into the existing required-token
 * (LIKE-contains, AND-joined) path so each word must appear in a candidate.
 *
 * IMPORTANT — robustness over perfection: ICU over-segments some domain compounds
 * (e.g. "วีออส" → "วี"+"ออส", "หม้อน้ำ" → "หม้อ"+"น้ำ"). That is harmless here
 * because matching is LIKE-substring against the RAW document text: each fragment
 * is still a substring of the original compound in the product name/alias, so the
 * AND still holds. This is why A-light targets the LIKE path, not FTS lexemes.
 */

// Words shorter than this carry little discriminating signal and risk
// over-constraining the AND filter; left to the broader match instead.
const MIN_THAI_TOKEN_LENGTH = 2;

// Common Thai particles / generic words that appear almost everywhere — requiring
// them adds no precision and only risks false exclusions.
const THAI_STOPWORDS = new Set([
  "ของ",
  "และ",
  "ที่",
  "ใน",
  "สำหรับ",
  "แบบ",
  "หรือ",
  "กับ",
]);

const THAI_CHAR_RE = /[฀-๿]/;

let cachedSegmenter: Intl.Segmenter | null | undefined;

const getThaiSegmenter = (): Intl.Segmenter | null => {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    cachedSegmenter = new Intl.Segmenter("th", { granularity: "word" });
  } catch {
    // Environment without full ICU — degrade to no segmentation (search still works).
    cachedSegmenter = null;
  }
  return cachedSegmenter;
};

/**
 * Segment the Thai-script portions of a query into words. Returns normalized,
 * deduped Thai words (≥2 chars, non-stopword). Latin/numeric tokens are ignored
 * here — they are already handled by whitespace tokenization and the code/OEM
 * matchers, and segmenting them could interfere with part-number matching.
 *
 * Returns [] for non-Thai queries or when ICU segmentation is unavailable, so the
 * caller's behaviour is unchanged in those cases.
 */
export function segmentThaiQueryTokens(query?: string | null): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized || !THAI_CHAR_RE.test(normalized)) return [];

  const segmenter = getThaiSegmenter();
  if (!segmenter) return [];

  const tokens = new Set<string>();
  for (const part of segmenter.segment(normalized)) {
    if (!part.isWordLike) continue;
    const word = part.segment.trim();
    // Only keep Thai-script words; skip Latin/number segments.
    if (!word || !THAI_CHAR_RE.test(word)) continue;
    if (word.length < MIN_THAI_TOKEN_LENGTH) continue;
    if (THAI_STOPWORDS.has(word)) continue;
    tokens.add(word);
  }

  return Array.from(tokens);
}
