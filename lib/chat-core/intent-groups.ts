import { LineIntent } from "@/lib/generated/prisma";
import type { LineIntentRouteResult } from "@/lib/chat-core/intent-router";

/**
 * The intent groups the AI classifier sorts a customer message into (Phase:
 * AI intent classification). Each group maps to a concrete action — answer from a
 * template/FAQ, search products, or acknowledge + hand off to an admin.
 */
export type LineMessageGroup =
  | "product"
  | "shop_info"
  | "general_faq"
  | "payment"
  | "shipping_address"
  | "order_status"
  | "price_negotiation"
  | "claim_or_return"
  | "purchase"
  | "greeting"
  | "social"
  | "smalltalk"
  | "out_of_scope"
  | "other";

export const LINE_MESSAGE_GROUPS: readonly LineMessageGroup[] = [
  "product",
  "shop_info",
  "general_faq",
  "payment",
  "shipping_address",
  "order_status",
  "price_negotiation",
  "claim_or_return",
  "purchase",
  "greeting",
  "social",
  "smalltalk",
  "out_of_scope",
  "other",
];

export function isLineMessageGroup(value: unknown): value is LineMessageGroup {
  return typeof value === "string" && (LINE_MESSAGE_GROUPS as readonly string[]).includes(value);
}

/**
 * High-stakes groups: anything touching money / commitments. A keyword match for
 * these in Layer-1 OVERRIDES the AI classification (the AI must never downgrade a
 * payment/claim/price/purchase message to a self-answer), and they always hand off
 * to a human — never auto-answered.
 */
export const GUARD_GROUPS: ReadonlySet<LineMessageGroup> = new Set<LineMessageGroup>([
  "payment",
  "price_negotiation",
  "claim_or_return",
  "purchase",
]);

/** Groups answered/served without a product search (no cards). */
export const NON_PRODUCT_GROUPS: ReadonlySet<LineMessageGroup> = new Set<LineMessageGroup>([
  "shop_info",
  "general_faq",
  "payment",
  "shipping_address",
  "order_status",
  "price_negotiation",
  "claim_or_return",
  "purchase",
  "greeting",
  "social",
  "smalltalk",
  "out_of_scope",
  "other",
]);

const buildRoute = (
  intent: LineIntent,
  overrides: Partial<LineIntentRouteResult>,
): LineIntentRouteResult => ({
  intent,
  allowsSearch: false,
  requiresAdmin: false,
  requiresImageAnalysis: false,
  requiresMoreInfo: false,
  reason: `GROUP_${intent}`,
  ...overrides,
});

/**
 * Translates a group into the existing `LineIntentRouteResult` so the downstream
 * pipeline (forced-response cascade, hand-off acks, send-decision policy) keeps
 * working unchanged. Returns null for groups handled by dedicated flags in the
 * processor (`general_faq` / `other` → FAQ-then-ask, `social` → brief/silent).
 */
export function groupToRoute(group: LineMessageGroup): LineIntentRouteResult | null {
  switch (group) {
    case "product":
      return buildRoute(LineIntent.PRODUCT_INQUIRY_TEXT, { allowsSearch: true });
    case "shop_info":
      return buildRoute(LineIntent.SHOP_INFO, {});
    case "greeting":
      return buildRoute(LineIntent.GREETING, {});
    case "payment":
      return buildRoute(LineIntent.PAYMENT_SLIP_IMAGE, { requiresAdmin: true });
    case "shipping_address":
      return buildRoute(LineIntent.SHIPPING_ADDRESS, { requiresAdmin: true });
    case "order_status":
      return buildRoute(LineIntent.ORDER_STATUS, { requiresAdmin: true });
    case "price_negotiation":
      return buildRoute(LineIntent.PRICE_NEGOTIATION, { requiresAdmin: true });
    case "claim_or_return":
      return buildRoute(LineIntent.CLAIM_OR_RETURN, { requiresAdmin: true });
    case "purchase":
      return buildRoute(LineIntent.PURCHASE_INTENT, { requiresAdmin: true });
    case "general_faq":
    case "other":
    case "social":
    case "smalltalk":
    case "out_of_scope":
      return null;
  }
}

/** Maps the Layer-1 regex intent back to a group (for guard detection + the
 *  classify-failure fallback that reuses the deterministic regex result). */
export function intentToGroup(intent: LineIntent): LineMessageGroup {
  switch (intent) {
    case LineIntent.PAYMENT_SLIP_IMAGE:
      return "payment";
    case LineIntent.SHIPPING_ADDRESS:
      return "shipping_address";
    case LineIntent.ORDER_STATUS:
      return "order_status";
    case LineIntent.PRICE_NEGOTIATION:
      return "price_negotiation";
    case LineIntent.CLAIM_OR_RETURN:
      return "claim_or_return";
    case LineIntent.PURCHASE_INTENT:
      return "purchase";
    case LineIntent.SHOP_INFO:
      return "shop_info";
    case LineIntent.GREETING:
      return "greeting";
    case LineIntent.PRODUCT_INQUIRY_TEXT:
    case LineIntent.PART_IMAGE_INQUIRY:
      return "product";
    default:
      return "other";
  }
}
