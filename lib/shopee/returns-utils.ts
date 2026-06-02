export type ShopeeReturnReviewKind = "NONE" | "CANCELLATION" | "RETURN" | "REFUND";

export type ShopeeReturnReviewSignal = {
  kind: ShopeeReturnReviewKind;
  reason: string | null;
};

type JsonObject = Record<string, unknown>;

const REVIEW_FIELD_HINTS = new Set([
  "cancel_reason",
  "cancel_by",
  "reverse_order_status",
  "return_sn",
  "return_status",
  "refund_status",
  "refund_amount",
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function findReviewHint(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findReviewHint(item);
      if (match) return match;
    }
    return null;
  }

  if (!isObject(value)) return null;

  for (const [key, child] of Object.entries(value)) {
    if (REVIEW_FIELD_HINTS.has(key)) {
      const text = cleanText(child);
      if (text) return `${key}: ${text}`;
    }
  }

  for (const child of Object.values(value)) {
    const match = findReviewHint(child);
    if (match) return match;
  }

  return null;
}

export function classifyShopeeReturnReviewSignal(status: string | null | undefined, rawPayload: unknown): ShopeeReturnReviewSignal {
  const normalized = status?.trim().toUpperCase() ?? "";
  const hint = findReviewHint(rawPayload);
  const hintText = hint?.toUpperCase() ?? "";
  const source = [normalized, hintText].join(" ");
  const fallbackReason = hint ?? normalized;

  if (source.includes("REFUND")) {
    return { kind: "REFUND", reason: fallbackReason || "Shopee refund signal" };
  }
  if (source.includes("RETURN") || source.includes("REVERSE")) {
    return { kind: "RETURN", reason: fallbackReason || "Shopee return signal" };
  }
  if (source.includes("CANCEL")) {
    return { kind: "CANCELLATION", reason: fallbackReason || "Shopee cancellation signal" };
  }

  return { kind: "NONE", reason: null };
}

export function getShopeeReviewPolicy(kind: ShopeeReturnReviewKind): string {
  if (kind === "NONE") return "NO_ACTION";
  return "MANUAL_REVIEW_ONLY";
}
