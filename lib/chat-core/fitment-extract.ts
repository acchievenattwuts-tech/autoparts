/**
 * Extracts lightweight fitment terms (car brand/model keywords + model years) from
 * a free-text message. Used to give the LINE product search short-term memory: when
 * the current message has no car/year of its own (e.g. an image, or "เอาตัวนี้"),
 * the most recent car/year the customer mentioned is folded back into the query.
 *
 * These terms are only ever appended to the search QUERY STRING (ranked by the V2
 * search), never used as a hard filter — so an imperfect match can't zero out
 * results.
 */

const CAR_KEYWORD_RE =
  /(vios|yaris|altis|camry|fortuner|hilux|revo|innova|sienta|city|jazz|civic|accord|cr-?v|hr-?v|brio|mobilio|freed|d[-\s]?max|mu[-\s]?x|almera|march|navara|teana|sylphy|triton|pajero|attrage|mirage|xpander|ranger|everest|swift|ertiga|ciaz|carry|toyota|honda|isuzu|nissan|mitsubishi|mazda|ford|chevrolet|suzuki|วีออส|ยาริส|อัลติส|แคมรี่|ฟอร์จูเนอร์|วีโก้|รีโว่|ซีวิค|แจ๊ส|ซิตี้|แอคคอร์ด|ดีแมคซ์|อีซูซุ|โตโยต้า|ฮอนด้า|นิสสัน|มาสด้า|มิตซู)/gi;

const YEAR_RE = /\b(19[89]\d|20[0-3]\d)\b/g;

// Two-digit Thai shorthand year, e.g. "ปี 06" / "ปี60". Mapped to a 4-digit C.E.
// year (00–35 → 2000–2035) so it survives into the search query the same way a
// full year would. Only triggers after the word "ปี" to avoid catching part-code
// fragments or quantities.
const SHORT_YEAR_RE = /ปี\s*(\d{2})\b/g;
const SHORT_YEAR_MAX = 35;

export function extractFitmentTerms(text: string | null | undefined): string[] {
  const value = text?.trim();
  if (!value) return [];

  const seen = new Set<string>();
  const terms: string[] = [];

  const collect = (match: string) => {
    const token = match.trim();
    const key = token.toLowerCase();
    if (!token || seen.has(key)) return;
    seen.add(key);
    terms.push(token);
  };

  for (const match of value.match(CAR_KEYWORD_RE) ?? []) collect(match);
  for (const match of value.match(YEAR_RE) ?? []) collect(match);

  // "ปี 06" → "2006" (only when the two-digit value is a plausible model year).
  for (const match of value.matchAll(SHORT_YEAR_RE)) {
    const twoDigit = Number(match[1]);
    if (twoDigit <= SHORT_YEAR_MAX) collect(String(2000 + twoDigit));
  }

  return terms;
}
