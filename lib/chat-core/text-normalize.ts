/**
 * Inbound-only text normalization for the LINE AI pipeline.
 *
 * Thai shoppers often glue a model code / year onto a Thai word with no space
 * ("วาล์วโตโยต้า134", "พัดลมโบยาริสปี08"). The search tokenizer
 * ({@link extractProductSearchRequiredTokens}) splits on whitespace only, so the
 * digit anchor ("134") stays fused to the Thai letters and is never extracted as
 * a required recall token. That silently bypasses the search guards (brand/model
 * grounding, vehicle-carryover reset), letting a stale fitment from a previous
 * turn hard-filter the results.
 *
 * Inserting a space at every Thai-letter↔ASCII-digit boundary fixes the
 * tokenization at the source. It deliberately touches ONLY Thai↔digit boundaries
 * so Latin model codes that mix letters and digits ("R134a", "STA-7065") are left
 * intact.
 *
 * Apply this to the text fed into classification / guarding / search — NOT to the
 * stored message or anything echoed back to the customer.
 */
const THAI_DIGIT_BOUNDARY = /([฀-๿])(\d)/g;
const DIGIT_THAI_BOUNDARY = /(\d)([฀-๿])/g;

export const normalizeInboundLineQuery = (text?: string | null): string =>
  (text ?? "")
    .replace(THAI_DIGIT_BOUNDARY, "$1 $2")
    .replace(DIGIT_THAI_BOUNDARY, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
