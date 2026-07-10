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
  "\u0e08\u0e39\u0e19\u0e02\u0e2d\u0e2a\u0e48\u0e07\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e43\u0e2b\u0e49\u0e41\u0e2d\u0e14\u0e21\u0e34\u0e19\u0e0a\u0e48\u0e27\u0e22\u0e40\u0e0a\u0e47\u0e01\u0e43\u0e2b\u0e49\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14\u0e01\u0e48\u0e2d\u0e19\u0e19\u0e30\u0e04\u0e30 \uD83D\uDE4F \u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e23\u0e16\u0e1a\u0e23\u0e23\u0e17\u0e38\u0e01\u0e21\u0e35\u0e2b\u0e25\u0e32\u0e22\u0e23\u0e38\u0e48\u0e19\u0e21\u0e32\u0e01 \u0e40\u0e14\u0e35\u0e4b\u0e22\u0e27\u0e23\u0e2d\u0e41\u0e2d\u0e14\u0e21\u0e34\u0e19\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e01\u0e25\u0e31\u0e1a\u0e2a\u0e31\u0e01\u0e04\u0e23\u0e39\u0e48\u0e04\u0e48\u0e30 \uD83D\uDE0A";

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
 * as an exact hit. Transparent about the guess and re-asks for the year when the
 * customer's year filter was dropped to find these.
 */
export function buildDidYouMeanNote(didYouMean: { suggestion: string; droppedYear: boolean }): string {
  const base = `จูนไม่เจอตรงคำที่พิมพ์พอดี เลยลองค้นจาก "${didYouMean.suggestion}" ให้ก่อนนะคะ 🙏 ถ้าไม่ตรงที่ต้องการ รบกวนพิมพ์ใหม่อีกครั้งได้เลยค่ะ`;
  return didYouMean.droppedYear
    ? `${base}\n(รายการนี้ยังไม่ได้กรองตามปีรถนะคะ ถ้าแจ้งปีมา จูนจะช่วยกรองให้ตรงรุ่นยิ่งขึ้นค่ะ 🚗)`
    : base;
}

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
