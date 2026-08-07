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
const LATIN_MODEL_SHORTHAND_YEAR_BOUNDARY = /\b([A-Za-z]{2,})(\d{2}(?:-\d{2})?)(?=\s|$)/g;
// Customers commonly omit the space between a numeric compressor model and its
// voltage ("50824v" = model 508, 24V). Split only a standalone numeric token
// with a 12V/24V suffix; mixed product codes such as R134a and STA-7065 stay intact.
const COMPACT_NUMERIC_VOLTAGE_BOUNDARY =
  /(?<![\p{L}\p{N}_-])(\d{3,}?)(12|24)(v)(?![\p{L}\p{N}_-])/giu;

export const normalizeInboundChatQuery = (text?: string | null): string =>
  (text ?? "")
    .replace(THAI_DIGIT_BOUNDARY, "$1 $2")
    .replace(DIGIT_THAI_BOUNDARY, "$1 $2")
    .replace(LATIN_MODEL_SHORTHAND_YEAR_BOUNDARY, "$1 $2")
    .replace(COMPACT_NUMERIC_VOLTAGE_BOUNDARY, "$1 $2$3")
    .replace(/\s+/g, " ")
    .trim();
