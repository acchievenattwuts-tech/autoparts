import type { ChatPartKind } from "@/lib/chat-core/ai-service";

/**
 * Pre-search completeness gate for LINE product turns.
 *
 * Rules (confirmed with the shop owner):
 *  1. partType + car (brand/model)            → search; nudge for the model YEAR.
 *  2. car (brand/model) + year                → search; nudge for the PART type.
 *  3. universal SKU (น้ำยา/น็อต/โอริง/ฟองน้ำ…) → search directly (no vehicle needed).
 *  - Anything too generic ("น็อต" alone)      → ask for more detail (do NOT search).
 *  - Only a part / only a car                 → ask for the missing half.
 *
 * Every "ask" path is a non-handoff reply (the AI stays active and keeps the
 * conversation moving — it must never freeze the room).
 */
export type ChatSearchGateFields = {
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
  partKind: ChatPartKind | null;
  tooBroad: boolean;
};

export type ChatSearchGateDecision =
  | { action: "search"; followUp: "ask_year" | "ask_part" | null; reason: string }
  | { action: "ask"; ask: "need_car" | "need_part" | "need_both" | "too_broad"; reason: string };

export const CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY =
  "จูนขอส่งเรื่องให้แอดมินช่วยเช็กสินค้าและรายละเอียดรถให้ชัดเจนก่อนนะคะ 🙏 เดี๋ยวแอดมินติดต่อกลับสักครู่ค่ะ 😊";

/**
 * Sent when the customer opens with a BROAD parts inquiry — "สอบถามอะไหล่รถครับ",
 * "หาอะไหล่แอร์" — that names no part and no vehicle. This is the start of a
 * conversation, not a dead end: the customer simply has not said what they need
 * yet, so จูน asks for the three things a search actually requires and STAYS
 * ACTIVE. Handing off here (as it did until 2026-08-02) froze the room and made a
 * human answer a question the customer was already about to answer themselves.
 */
export const CHAT_BROAD_PART_INQUIRY_ASK_REPLY = [
  "ถ้าต้องการให้จูนช่วยค้นหาอะไหล่แอร์หรือหม้อน้ำรถยนต์ รบกวนแจ้ง 3 อย่างนี้",
  "เดี๋ยวจูนค้นให้ทันทีเลยค่ะ 👇",
  "1️⃣ ยี่ห้อ / รุ่นรถ (เช่น Toyota Vios 2020)",
  "2️⃣ อะไหล่ที่ต้องการ (เช่น คอมเพรสเซอร์, แผงร้อน, ตู้แอร์, หม้อน้ำ)",
  "3️⃣ รูปอะไหล่เก่า (ถ้ามี จะช่วยให้ระบุรุ่นแม่นขึ้น)",
].join("\n");

/**
 * Sent when the customer named a car model the system could NOT lock to a fitment
 * filter (Option A vehicle-unresolved guard). Rather than show other vehicles'
 * parts as "close matches", \u0e08\u0e39\u0e19 asks the customer to confirm the make/model and
 * hands off to an admin \u2014 the "\u0e44\u0e21\u0e48\u0e21\u0e31\u0e48\u0e19\u0e43\u0e08\u0e2a\u0e48\u0e07\u0e41\u0e2d\u0e14\u0e21\u0e34\u0e19" rule.
 */
export const CHAT_VEHICLE_UNRESOLVED_HANDOFF_REPLY =
  "\u0e23\u0e1a\u0e01\u0e27\u0e19\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e22\u0e35\u0e48\u0e2b\u0e49\u0e2d/\u0e23\u0e38\u0e48\u0e19\u0e23\u0e16\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07\u0e19\u0e30\u0e04\u0e30 \u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e43\u0e2b\u0e49\u0e08\u0e39\u0e19\u0e40\u0e0a\u0e47\u0e04\u0e2d\u0e30\u0e44\u0e2b\u0e25\u0e48\u0e43\u0e2b\u0e49\u0e15\u0e23\u0e07\u0e23\u0e38\u0e48\u0e19\u0e23\u0e16\u0e17\u0e35\u0e48\u0e2a\u0e38\u0e14 \uD83D\uDE4F \u0e40\u0e14\u0e35\u0e4b\u0e22\u0e27\u0e08\u0e39\u0e19\u0e2a\u0e48\u0e07\u0e43\u0e2b\u0e49\u0e41\u0e2d\u0e14\u0e21\u0e34\u0e19\u0e0a\u0e48\u0e27\u0e22\u0e14\u0e39\u0e43\u0e2b\u0e49\u0e2d\u0e35\u0e01\u0e41\u0e23\u0e07\u0e19\u0e30\u0e04\u0e30 \uD83D\uDE0A";

/**
 * Sent when the search resolved NO category (categoryName=null) and the returned
 * rows are only weakly linked to what the customer asked (no strong code/OEM/
 * name/keyword/fitment match, and not a close-enough trigram near-match) — so
 * showing them risks presenting the wrong item as if it fits. จูน hands off to an
 * admin instead of guessing — the "ไม่มั่นใจอย่าตอบมั่ว ส่งแอดมิน" rule.
 */
export const CHAT_WEAK_MATCH_HANDOFF_REPLY =
  "ขออนุญาตส่งเรื่องให้แอดมินช่วยเช็กให้แน่ใจก่อนนะคะ 🙏 อยากให้ได้อะไหล่ที่ตรงกับที่ต้องการจริง ๆ เดี๋ยวรอแอดมินติดต่อกลับสักครู่ค่ะ 😊";

const BROAD_PART_TYPE_PATTERNS = [
  /อะไหล่\s*แอ[รร์]/i,
  /อะไหล่\s*รถ/i,
  /อะไหล่\s*สิบล้อ/i,
  /อะไหล่\s*บรรทุก/i,
  /ระบบ\s*แอ[รร์]/i,
];

export function isBroadChatPartType(value?: string | null): boolean {
  const text = value?.trim();
  if (!text) return false;
  return BROAD_PART_TYPE_PATTERNS.some((pattern) => pattern.test(text));
}

export function decideChatSearchGate(fields: ChatSearchGateFields): ChatSearchGateDecision {
  const hasPart = Boolean(fields.partType);
  const hasCar = Boolean(fields.carBrand || fields.carModel);
  const hasYear = fields.year !== null && fields.year !== undefined;
  const isUniversal = fields.partKind === "universal";

  if (hasPart && isBroadChatPartType(fields.partType)) {
    return { action: "ask", ask: "need_part", reason: "BROAD_PART_TYPE" };
  }

  // Universal SKUs are searchable on their own name/spec — but a bare generic
  // word ("น็อต") is still too broad to be useful.
  if (isUniversal) {
    if (fields.tooBroad && !hasCar && !hasPart) {
      return { action: "ask", ask: "too_broad", reason: "UNIVERSAL_TOO_BROAD" };
    }
    return { action: "search", followUp: null, reason: "UNIVERSAL_DIRECT" };
  }

  // Rule 1: part + car → search (nudge for year if missing).
  if (hasPart && hasCar) {
    return { action: "search", followUp: hasYear ? null : "ask_year", reason: "PART_PLUS_CAR" };
  }

  // Rule 2: car + year (no part) → search (nudge for the part type).
  if (hasCar && hasYear) {
    return { action: "search", followUp: "ask_part", reason: "CAR_PLUS_YEAR" };
  }

  // Incomplete fitment → ask for the missing half (never freeze the room).
  if (hasPart && !hasCar) {
    return { action: "ask", ask: "need_car", reason: "PART_ONLY" };
  }
  if (hasCar && !hasPart) {
    return { action: "ask", ask: "need_part", reason: "CAR_ONLY" };
  }

  return { action: "ask", ask: "too_broad", reason: "INSUFFICIENT_DETAIL" };
}

// ── จูน-voiced messages ──────────────────────────────────────────────────────

/** Follow-up bubble sent AFTER the product flex cards (customer already saw the
 *  matches; we ask for one more detail to pin the exact fit). */
export function buildChatSearchFollowUp(followUp: "ask_year" | "ask_part"): string {
  if (followUp === "ask_year") {
    return "นี่เป็นรายการที่ใกล้เคียงเบื้องต้นนะคะ 😊 ถ้าแจ้งปีรถมาเพิ่ม จูนจะช่วยกรองให้ตรงรุ่นยิ่งขึ้นค่ะ 🚗";
  }
  return "เบื้องต้นจูนเลือกมาให้ดูก่อนนะคะ 😊 ถ้าบอกชนิดอะไหล่ที่ต้องการ (เช่น หม้อน้ำ คอยล์เย็น คอมแอร์) จะช่วยให้จูนเจาะให้ตรงที่สุดค่ะ";
}

/**
 * Note shown AFTER the product cards when the results came from a "did you mean"
 * spelling/synonym recovery — so a corrected (and year-stripped) match never reads
 * as an exact hit.
 *
 * The note NEVER asks for the car year. The year filter is only ever dropped when the
 * customer already supplied a year — so the old "ถ้าแจ้งปีมา จูนจะช่วยกรองให้" line
 * asked for a detail they had just typed ("ซิตี้96" → asked for the year anyway).
 * When `yearMismatch` is set the catalog was checked against that year and genuinely
 * has nothing for it, so the note says so outright; "ยังไม่ได้กรองตามปีรถ" would read
 * as "we just didn't filter", which is the wrong-year answer the 1996 City incident
 * produced.
 */
export function buildDidYouMeanNote(
  didYouMean: { suggestion: string },
  yearMismatch?: { requestedYear: number } | null,
): string {
  const base = `จูนค้นจากคำว่า "${didYouMean.suggestion}" ให้นะคะ 🙏 ถ้าไม่ตรง พิมพ์ใหม่ได้เลยค่ะ`;
  return yearMismatch ? `${base}\n${buildYearMismatchNote(yearMismatch.requestedYear)}` : base;
}

/**
 * Note for rows shown after the catalog turned out to have NOTHING for the year the
 * customer gave. States the miss first, then frames the rows as other-year options —
 * never a verdict on whether they fit (the shop's "ห้ามตัดสินแทนลูกค้า" rule).
 */
export function buildYearMismatchNote(requestedYear: number): string {
  return `(ในระบบยังไม่มีของปี ${requestedYear} นะคะ รายการด้านบนเป็นรุ่นปีอื่นให้ดูเทียบเคียง ยังไม่ยืนยันว่าใส่ได้ — ส่งรูปอะไหล่ตัวเดิมมาให้จูนเทียบ หรือให้แอดมินเช็กต่อได้ค่ะ 🚗)`;
}

/**
 * Note shown AFTER the product cards when results came from the engine's broad
 * OR recall (the precise AND query matched nothing, so every row matched only
 * PART of the query — the right car but a different part, or the right part on a
 * different car). Keeps the shop's "ไม่มั่นใจอย่าตอบมั่ว" flag honest by telling
 * the customer these are near-matches, not exact hits, and inviting a re-check.
 */
export const BROAD_FALLBACK_NEAR_MATCH_NOTE =
  'รายการนี้เป็นรายการ "ใกล้เคียง" ที่จูนหาให้ อาจไม่ตรงทั้งหมดนะคะ 🙏 ถ้ายังไม่ตรงที่ต้องการ รบกวนแจ้งรายละเอียดเพิ่ม (รุ่นรถ/ปี/ชนิดอะไหล่) หรือพิมพ์ใหม่อีกครั้ง จูนจะช่วยหาให้ตรงยิ่งขึ้นค่ะ';

/** Reply used when the gate blocks the search and asks for the missing detail. */
export function buildChatSearchAskReply(ask: "need_car" | "need_part" | "need_both" | "too_broad"): string {
  switch (ask) {
    case "need_car":
      return "ได้เลยค่ะ 😊 รบกวนแจ้งยี่ห้อ/รุ่นรถด้วยนะคะ (เช่น D-Max, Vios, แจ๊ส) จะได้ช่วยหาอะไหล่ให้ตรงรุ่นค่ะ 🚗";
    case "need_part":
      return "ได้เลยค่ะ 😊 รบกวนบอกชนิดอะไหล่ที่ต้องการด้วยนะคะ (เช่น หม้อน้ำ คอยล์เย็น คอมแอร์) จะได้ช่วยเลือกให้ตรงที่สุดค่ะ";
    case "need_both":
      return "ยินดีช่วยหาให้เลยค่ะ 😊 รบกวนแจ้งชนิดอะไหล่ + ยี่ห้อ/รุ่นรถ (เช่น หม้อน้ำ D-Max) จะได้ค้นให้ตรงรุ่นนะคะ 🚗";
    case "too_broad":
      return "รบกวนบอกรายละเอียดเพิ่มอีกนิดนะคะ 😊 เช่น ชนิดอะไหล่ + ยี่ห้อ/รุ่นรถ หรือสเปก/ขนาด จะได้ช่วยหาให้ตรงที่สุดค่ะ";
  }
}
