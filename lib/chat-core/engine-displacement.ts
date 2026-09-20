import { normalizeSearchText } from "@/lib/search-normalization";

export type ChatEngineDisplacement = {
  cc: number;
  liters: number;
  token: string;
};

const DECIMAL_LITERS_RE = /(?:^|[^0-9])([1-9]\.[0-9])(?:\s*(?:l|liter|litre|ลิตร))?(?=$|[^0-9])/giu;
const EXPLICIT_CC_RE = /(?<![\p{L}\p{N}_-])([1-9][0-9]{2,3})\s*(?:cc|ซีซี)(?![\p{L}\p{N}_-])/giu;
const ENGINE_CUE_BEFORE_CC_RE =
  /(?:เครื่อง(?:ยนต์)?|เบนซิน|ดีเซล)\s*([1-9][0-9]{2,3})(?![0-9])/giu;
const ENGINE_CUE_AFTER_CC_RE =
  /(?<![0-9])([1-9][0-9]{2,3})\s*(?:เบนซิน|ดีเซล)(?![\p{L}\p{N}_-])/giu;

const toLiters = (cc: number): number => Number((cc / 1000).toFixed(3));

const isPlausibleContextualCc = (cc: number): boolean =>
  cc >= 1000 && cc <= 9000 && cc % 100 === 0;

/**
 * Finds customer-authored engine displacement while keeping unrelated numeric
 * product/model codes untouched. A bare number is accepted only beside an engine
 * or fuel cue ("เบนซิน2700", "เครื่อง 2500"); an explicit cc/ซีซี suffix is
 * already unambiguous. This intentionally does not reinterpret a standalone
 * "2500" because numeric part/model codes use the same shape.
 */
export function extractChatEngineDisplacements(text?: string | null): ChatEngineDisplacement[] {
  const normalized = normalizeSearchText(text);
  if (!normalized) return [];

  const byCc = new Map<number, ChatEngineDisplacement>();
  const add = (raw: string | undefined, contextual: boolean) => {
    if (!raw) return;
    const cc = Number(raw);
    if (!Number.isFinite(cc) || (contextual && !isPlausibleContextualCc(cc))) return;
    byCc.set(cc, { cc, liters: toLiters(cc), token: raw.toLowerCase() });
  };

  for (const match of normalized.matchAll(EXPLICIT_CC_RE)) add(match[1], false);
  for (const match of normalized.matchAll(ENGINE_CUE_BEFORE_CC_RE)) add(match[1], true);
  for (const match of normalized.matchAll(ENGINE_CUE_AFTER_CC_RE)) add(match[1], true);

  return Array.from(byCc.values());
}

/** Converts only verified engine-displacement numbers to the catalog's litre form. */
export function normalizeChatEngineDisplacement(text?: string | null): string {
  const value = text ?? "";
  const recognized = new Map(
    extractChatEngineDisplacements(value).map((item) => [String(item.cc), item.liters.toFixed(1)]),
  );
  if (recognized.size === 0) return value;

  const replaceCc = (match: string, raw: string): string => {
    const liters = recognized.get(raw);
    return liters ? match.replace(raw, liters) : match;
  };

  return value
    .replace(EXPLICIT_CC_RE, (match, raw: string) => recognized.get(raw) ?? match)
    .replace(ENGINE_CUE_BEFORE_CC_RE, replaceCc)
    .replace(ENGINE_CUE_AFTER_CC_RE, replaceCc);
}

/** Engine sizes used by the post-search compatibility guard. */
export function extractChatEngineSizes(text?: string | null): Set<number> {
  const normalized = normalizeSearchText(text);
  const sizes = new Set<number>();
  for (const match of normalized.matchAll(DECIMAL_LITERS_RE)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) sizes.add(parsed);
  }
  for (const displacement of extractChatEngineDisplacements(normalized)) {
    sizes.add(displacement.liters);
  }
  return sizes;
}
