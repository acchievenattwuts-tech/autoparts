/**
 * test-live-broad-part-inquiry.ts
 *
 * Validates the broad-opener rule against the REAL Gemini classifier.
 *
 * Why this exists: production 2026-08-02 (conv cmsbfjzlo) — a first-time customer
 * wrote "สวัสดีครับ" then "สอบถามอะไหล่รถครับ". The phrase matches the broad
 * pattern /อะไหล่\s*รถ/, so the turn forced BROAD_PART_TYPE_HANDOFF: จูน replied
 * "ขอส่งเรื่องให้แอดมิน", froze the room and pulled in a human — for a customer who
 * had simply not said yet what they wanted. The rule now asks for the three things
 * a search needs and stays active, but ONLY when the conversation carries no
 * subject yet (part category / car model / car year). Mid-conversation the same
 * wording is a follow-up and the hand-off still stands.
 *
 * Broadness itself is a deterministic regex, but the GROUP that gets a turn to the
 * gate comes from the LLM — so this replays real phrasings through the live
 * classifier and checks the end-to-end decision the processor would take.
 *
 * Read-only: calls Gemini, reads nothing from the DB, writes nothing.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-live-broad-part-inquiry.ts
 */

import { LineIntent } from "../lib/generated/prisma";
import { extractChatSearchIntent, type ChatReplyHistoryItem } from "../lib/chat-core/ai-service";
import {
  decideChatSearchGate,
  isBroadChatPartType,
  type ChatSearchGateDecision,
} from "../lib/chat-core/search-gate";

type Carried = { partType: string | null; carBrand: string | null; carModel: string | null; year: number | null };

type Case = {
  label: string;
  text: string;
  history?: ChatReplyHistoryItem[];
  /** Frame carried from earlier turns — the thing that decides ask vs hand-off. */
  carried: Carried;
  expect: "ask_three_details" | "handoff" | "normal_flow";
};

const EMPTY: Carried = { partType: null, carBrand: null, carModel: null, year: null };

const CASES: Case[] = [
  // ── Fresh openers: must ASK, never freeze ────────────────────────────────
  {
    label: "the production turn",
    text: "สอบถามอะไหล่รถครับ",
    history: [
      { role: "customer", text: "สวัสดีครับ" },
      { role: "shop", text: "สวัสดีค่ะ ยินดีต้อนรับสู่ศรีวรรณอะไหล่แอร์นะคะ" },
    ],
    carried: EMPTY,
    expect: "ask_three_details",
  },
  { label: "bare parts inquiry", text: "สอบถามอะไหล่รถ", carried: EMPTY, expect: "ask_three_details" },
  { label: "looking for a/c parts", text: "หาอะไหล่แอร์ครับ", carried: EMPTY, expect: "ask_three_details" },
  { label: "do you have a/c parts", text: "มีอะไหล่แอร์ไหมครับ", carried: EMPTY, expect: "ask_three_details" },
  { label: "shorthand opener", text: "อะไหล่แอร์รถยนต์ครับ", carried: EMPTY, expect: "ask_three_details" },
  { label: "bare stock ask, no parts word", text: "ที่ร้านมีของใช้ไหมคัฟ", carried: EMPTY, expect: "handoff" },

  // ── Same wording, but the customer already told us what car/part ─────────
  {
    label: "broad wording after a specific inquiry",
    text: "สอบถามอะไหล่รถครับ",
    history: [
      { role: "customer", text: "คอยล์เย็น vios ปี 2018" },
      { role: "shop", text: "จูนเช็กให้แล้วนะคะ มีรายการที่ใกล้เคียงค่ะ" },
    ],
    carried: { partType: "คอยล์เย็น", carBrand: "Toyota", carModel: "Vios", year: 2018 },
    expect: "handoff",
  },

  // ── Specific enough to search: must not be caught by the rule ────────────
  { label: "specific part + car", text: "คอมแอร์ vios ปี 2015 มีไหมครับ", carried: EMPTY, expect: "normal_flow" },
  { label: "specific part only", text: "หม้อน้ำ d-max", carried: EMPTY, expect: "normal_flow" },
  { label: "part photo wording", text: "โบลเวอร์ jazz ge", carried: EMPTY, expect: "normal_flow" },
];

type Outcome = "ask_three_details" | "handoff" | "normal_flow" | "non_product";

/**
 * Mirrors the processor's decision chain for the branches this rule touches.
 * A broad opener reaches the chain through EITHER door — `product` (the
 * BROAD_PART_TYPE gate) or `stock_availability` — so both are modelled here.
 */
function decide(
  group: string,
  consolidatedQuery: string | null,
  latestText: string,
  carried: Carried,
  gate: ChatSearchGateDecision | null,
): Outcome {
  const latestTurnIsBroad = isBroadChatPartType(consolidatedQuery) || isBroadChatPartType(latestText);
  const hasCarriedContext = Boolean(carried.partType || carried.carBrand || carried.carModel || carried.year);

  if (group === "stock_availability") {
    // stockAvailabilityDirect fires when nothing searchable is named this turn.
    return latestTurnIsBroad && !hasCarriedContext ? "ask_three_details" : "handoff";
  }
  if (group !== "product") return "non_product";
  if (!latestTurnIsBroad) return "normal_flow";
  return hasCarriedContext ? "handoff" : "ask_three_details";
}

async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;

  for (const testCase of CASES) {
    const intent = await extractChatSearchIntent({
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      latestText: testCase.text,
      history: testCase.history ?? [],
    }).catch(() => null);

    const group = intent?.group ?? "other";
    const gate =
      intent && group === "product"
        ? decideChatSearchGate({
            partType: intent.partType ?? testCase.carried.partType,
            carBrand: intent.carBrand ?? testCase.carried.carBrand,
            carModel: intent.carModel ?? testCase.carried.carModel,
            year: intent.year ?? testCase.carried.year,
            partKind: intent.partKind ?? null,
            tooBroad: intent.tooBroad ?? false,
          })
        : null;

    const outcome = decide(group, intent?.query ?? null, testCase.text, testCase.carried, gate);
    const ok = outcome === testCase.expect;
    if (ok) pass += 1;
    else fail += 1;

    console.log(
      `${ok ? "PASS" : "FAIL"}  ${testCase.label.padEnd(38)} "${testCase.text}"\n` +
        `        group=${group} tooBroad=${String(intent?.tooBroad ?? false)} ` +
        `partType=${String(intent?.partType)} carModel=${String(intent?.carModel)} ` +
        `query=${JSON.stringify(intent?.query ?? null)}\n` +
        `        outcome=${outcome}  expected=${testCase.expect}`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed (live Gemini, ${CASES.length} cases)`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
