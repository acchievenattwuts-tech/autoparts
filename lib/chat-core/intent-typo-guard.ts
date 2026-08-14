import { LineIntent } from "@/lib/generated/prisma";
import { ADMIN_ONLY_KNOWLEDGE_TYPO_PHRASES } from "@/lib/chat-core/admin-only-knowledge";
import { foldThaiSpelling } from "@/lib/thai-spelling-fold";
import { containsWithinEditDistance } from "@/lib/chat-core/typo-distance";

/**
 * Typo-tolerant backstop for the HIGH-STAKES intent keywords in
 * {@link ../chat-core/intent-router}.
 *
 * The router's rules are literal `contains` regexes, and its final branch treats
 * anything unmatched as a product inquiry. That default is right for the long tail
 * (a Thai part name we've never seen), but it is the WRONG answer for a mis-keyed
 * operational message: "เครม" (เคลม), "สลิบ" (สลิป), "โอนเงืน" (โอนเงิน) all fall
 * through and get answered with product cards while the customer is trying to make
 * a claim or report a transfer.
 *
 * Because the regexes match substrings, prefix/suffix noise ("เคลมส์") is already
 * handled. What is NOT handled is an INTERNAL misspelling — that is this module's
 * entire scope.
 *
 * ── Safety design (why this cannot make an answer worse) ────────────────────────
 *  1. It runs ONLY after every literal rule has missed, and only immediately
 *     before the default "assume product" branch. A message the router already
 *     classifies is never seen by this code, so those paths are byte-identical.
 *  2. Edit budget is a FLAT 1 — never scaled by length. A 1-edit radius is the
 *     narrowest thing that still catches the real slips (one wrong/missing/extra
 *     character, or an adjacent swap).
 *  3. Both sides are Thai-spelling-folded first, so tone-mark omissions cost 0
 *     edits and the whole 1-edit budget stays available for the actual typo.
 *  4. Keywords are compound/distinctive words only. Short ambiguous ones from the
 *     literal rules ("เสีย", "พัง", "โอน", "ที่อยู่") are deliberately absent — a
 *     1-edit radius around a short common word WOULD collide with parts vocabulary.
 *  5. `scripts/test-chat-robustness-golden.ts` proves against the LIVE catalog that
 *     no active product name, category, car model/brand, or search keyword falls
 *     inside the 1-edit radius of any keyword here. A new keyword that collides
 *     fails that suite instead of silently mis-routing customers.
 *
 * The resulting route reuses the EXACT `reason` string of the literal rule it
 * stands in for, so every downstream comparison in the channel processors
 * (`hardGuard`, `quotationRequest`, the shipping checks) behaves identically to a
 * literal hit. The `matchedVia: "typo"` flag on the route carries the observability
 * instead.
 */

export type ChatIntentTypoMatch = {
  intent: LineIntent;
  /** The literal rule's reason string — kept identical so routing is unchanged. */
  reason: string;
  /** The canonical keyword that matched, for the audit trail. */
  keyword: string;
};

type TypoKeywordGroup = {
  intent: LineIntent;
  reason: string;
  keywords: string[];
};

/**
 * Evaluated in this order, mirroring the literal rule order in the router so an
 * ambiguous message lands on the same intent it would have with correct spelling.
 */
const TYPO_KEYWORD_GROUPS: TypoKeywordGroup[] = [
  {
    // PAYMENT_RE — money already moved / is moving. Mis-routing this to product
    // search leaves a paying customer unacknowledged.
    intent: LineIntent.PAYMENT_SLIP_IMAGE,
    reason: "PAYMENT_KEYWORD",
    keywords: ["สลิป", "โอนเงิน", "โอนแล้ว", "พร้อมเพย์", "ชำระเงิน", "ยอดเงิน", "จ่ายแล้ว"],
  },
  {
    // Shipping is admin-only in every case (shop rule). Compound forms only —
    // bare "ที่อยู่" is far too close to ordinary question words.
    intent: LineIntent.SHIPPING_ADDRESS,
    reason: "SHIPPING_ADMIN_ONLY",
    keywords: [
      "รหัสไปรษณีย์",
      "ที่อยู่จัดส่ง",
      "เก็บเงินปลายทาง",
      "ค่าจัดส่ง",
      "ส่งต่างจังหวัด",
      ...ADMIN_ONLY_KNOWLEDGE_TYPO_PHRASES.shipping,
    ],
  },
  {
    // CLAIM_RE — warranty / return / replacement.
    //
    // Bare "เคลม" is DELIBERATELY ABSENT. The golden suite measured it against the
    // live catalog and found it one edit from "แคลมป์รัดท่อ" (a hose clamp the shop
    // actually sells) — so guarding it would route a customer shopping for a clamp
    // into a warranty hand-off. The literal CLAIM_RE still catches correctly-spelled
    // "เคลม" and is unaffected by that collision, because it matches exactly.
    // The compound forms below keep typo coverage ("เครมของ" → เคลมของ is one edit)
    // while being long enough to stay clear of the clamp.
    intent: LineIntent.CLAIM_OR_RETURN,
    reason: "CLAIM_KEYWORD",
    keywords: [
      "เคลมของ",
      "เคลมสินค้า",
      "ขอเคลม",
      "คืนสินค้า",
      "เปลี่ยนสินค้า",
      "รับประกัน",
      "ชำรุด",
      ...ADMIN_ONLY_KNOWLEDGE_TYPO_PHRASES.warranty_return,
    ],
  },
  {
    // Asking for a bank-account number is a purchase hand-off, not evidence that
    // money has already moved (PAYMENT_SLIP_IMAGE).
    intent: LineIntent.PURCHASE_INTENT,
    reason: "PURCHASE_INTENT_KEYWORD",
    keywords: ["เลขบันชี"],
  },
  {
    // A quotation is an operational sales request the shop must produce by hand.
    intent: LineIntent.PURCHASE_INTENT,
    reason: "QUOTATION_REQUEST_KEYWORD",
    keywords: ["ใบเสนอราคา"],
  },
  {
    intent: LineIntent.ORDER_STATUS,
    reason: "ORDER_STATUS_KEYWORD",
    keywords: ["เลขพัสดุ", "ติดตามพัสดุ", "เลขติดตาม", "สถานะออเดอร์", "เลขแทรกกิ้ง"],
  },
  {
    // Answerable from SiteConfig — a typo here otherwise sends the customer into a
    // product search that can never contain the shop's phone number.
    intent: LineIntent.SHOP_INFO,
    reason: "SHOP_INFO_KEYWORD",
    keywords: ["เวลาทำการ", "เบอร์โทร", "ที่ตั้งร้าน", "เวลาเปิดร้าน", "ร้านยุไหน"],
  },
];

/** Flat, never length-scaled — see safety note 2. */
const TYPO_MAX_EDITS = 1;
/**
 * Shortest folded keyword allowed. Below this a 1-edit radius covers too large a
 * share of the Thai 3-character space to stay distinctive.
 */
const MIN_FOLDED_KEYWORD_LENGTH = 4;

export type ChatIntentTypoKeyword = { keyword: string; folded: string; reason: string };

/**
 * Every keyword this guard actually enforces, in folded form. Exported so the
 * golden suite can assert catalog non-collision against the SAME list the runtime
 * uses (rather than a copy that could drift).
 */
export const CHAT_INTENT_TYPO_KEYWORDS: ChatIntentTypoKeyword[] = TYPO_KEYWORD_GROUPS.flatMap(
  (group) =>
    group.keywords
      .map((keyword) => ({ keyword, folded: foldThaiSpelling(keyword), reason: group.reason }))
      .filter((entry) => entry.folded.length >= MIN_FOLDED_KEYWORD_LENGTH),
);

/**
 * Returns the high-stakes intent a mis-keyed message was reaching for, or null.
 *
 * MUST be called only after every literal router rule has missed — it assumes an
 * exact hit would already have been handled, so an exact-distance-0 match here is
 * simply a keyword the literal regex spells differently (harmless, same answer).
 */
export function detectChatIntentTypo(text: string | null | undefined): ChatIntentTypoMatch | null {
  const folded = foldThaiSpelling(text).replace(/\s+/g, "");
  if (!folded) return null;

  for (const group of TYPO_KEYWORD_GROUPS) {
    for (const keyword of group.keywords) {
      const foldedKeyword = foldThaiSpelling(keyword).replace(/\s+/g, "");
      if (foldedKeyword.length < MIN_FOLDED_KEYWORD_LENGTH) continue;
      if (containsWithinEditDistance(foldedKeyword, folded, TYPO_MAX_EDITS)) {
        return { intent: group.intent, reason: group.reason, keyword };
      }
    }
  }

  return null;
}
