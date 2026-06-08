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
  /(vios|yaris|altis|camry|fortuner|hilux|revo|innova|sienta|city|jazz|civic|accord|cr-?v|hr-?v|brio|mobilio|freed|d-?max|mu-?x|almera|march|navara|teana|sylphy|triton|pajero|attrage|mirage|xpander|ranger|everest|swift|ertiga|ciaz|carry|toyota|honda|isuzu|nissan|mitsubishi|mazda|ford|chevrolet|suzuki|วีออส|ยาริส|อัลติส|แคมรี่|ฟอร์จูเนอร์|วีโก้|รีโว่|ซีวิค|แจ๊ส|ซิตี้|แอคคอร์ด|ดีแมคซ์|อีซูซุ|โตโยต้า|ฮอนด้า|นิสสัน|มาสด้า|มิตซู)/gi;

const YEAR_RE = /\b(19[89]\d|20[0-3]\d)\b/g;

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

  return terms;
}
