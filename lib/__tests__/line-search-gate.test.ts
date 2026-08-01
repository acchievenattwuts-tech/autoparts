import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDidYouMeanNote,
  CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY,
  decideChatSearchGate,
  type ChatSearchGateFields,
} from "@/lib/chat-core/search-gate";

function fields(overrides: Partial<ChatSearchGateFields>): ChatSearchGateFields {
  return {
    partType: null,
    carBrand: null,
    carModel: null,
    year: null,
    partKind: null,
    tooBroad: false,
    ...overrides,
  };
}

test("rule 1: part + car (no year) → search + ask_year", () => {
  const d = decideChatSearchGate(fields({ partType: "หม้อน้ำ", carModel: "D-Max", partKind: "fitment" }));
  assert.deepEqual(d, { action: "search", followUp: "ask_year", reason: "PART_PLUS_CAR" });
});

test("rule 1: part + car + year → search, no follow-up", () => {
  const d = decideChatSearchGate(
    fields({ partType: "หม้อน้ำ", carModel: "D-Max", year: 2015, partKind: "fitment" }),
  );
  assert.equal(d.action, "search");
  assert.equal(d.action === "search" ? d.followUp : "x", null);
});

test("rule 2: car + year (no part) → search + ask_part", () => {
  const d = decideChatSearchGate(fields({ carModel: "Vios", year: 2003, partKind: "fitment" }));
  assert.deepEqual(d, { action: "search", followUp: "ask_part", reason: "CAR_PLUS_YEAR" });
});

test("rule 3: universal SKU → search directly, no vehicle needed", () => {
  const d = decideChatSearchGate(fields({ partType: "น้ำยาล้างคอยล์", partKind: "universal" }));
  assert.deepEqual(d, { action: "search", followUp: null, reason: "UNIVERSAL_DIRECT" });
});

test("part only (fitment) → ask for car", () => {
  const d = decideChatSearchGate(fields({ partType: "หม้อน้ำ", partKind: "fitment" }));
  assert.equal(d.action, "ask");
  assert.equal(d.action === "ask" ? d.ask : "x", "need_car");
});

test("car only (fitment) → ask for part", () => {
  const d = decideChatSearchGate(fields({ carModel: "D-Max", partKind: "fitment" }));
  assert.equal(d.action, "ask");
  assert.equal(d.action === "ask" ? d.ask : "x", "need_part");
});

test("bare generic word → too_broad ask", () => {
  const d = decideChatSearchGate(fields({ partType: null, tooBroad: true }));
  assert.equal(d.action, "ask");
  assert.equal(d.action === "ask" ? d.ask : "x", "too_broad");
});

test("universal but too broad bare word → ask", () => {
  const d = decideChatSearchGate(fields({ partKind: "universal", tooBroad: true }));
  assert.equal(d.action, "ask");
  assert.equal(d.action === "ask" ? d.ask : "x", "too_broad");
});

test("nothing extracted → too_broad ask", () => {
  const d = decideChatSearchGate(fields({}));
  assert.equal(d.action, "ask");
});

test("broad aircon parts inquiry with truck brands asks for the part category first", () => {
  const d = decideChatSearchGate(
    fields({
      partType: "อะไหล่แอร์",
      carModel: "สิบล้อ HINO, ISUZU",
      partKind: "fitment",
      tooBroad: false,
    }),
  );

  assert.deepEqual(d, { action: "ask", ask: "need_part", reason: "BROAD_PART_TYPE" });
});

test("generic uncertain fallback never assumes the customer has a truck", () => {
  assert.doesNotMatch(CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY, /รถบรรทุก/);
});

test("did-you-mean note names the corrected term", () => {
  const note = buildDidYouMeanNote({ suggestion: "คอยเย็น avanza" });
  assert.ok(note.includes("คอยเย็น avanza"));
  assert.ok(!note.includes("ปีรถ"));
});

test("did-you-mean note never asks for a car year the customer already typed", () => {
  // droppedYear is only ever set when the customer DID supply a year, so re-asking
  // for it ("ซิตี้96" → "ถ้าแจ้งปีมา") is always wrong.
  const note = buildDidYouMeanNote({ suggestion: "คอยเย็น avanza" });
  assert.ok(note.includes("คอยเย็น avanza"));
  assert.ok(!note.includes("ถ้าแจ้งปีมา"));
  assert.ok(!note.includes("ยังไม่ได้กรองตามปีรถ"));
});

test("year-mismatch note says the asked year is NOT in stock, not merely unfiltered", () => {
  const note = buildDidYouMeanNote(
    { suggestion: "มูเล่ย์หน้าคลัช" },
    { requestedYear: 1996 },
  );
  assert.ok(note.includes("มูเล่ย์หน้าคลัช"));
  assert.ok(note.includes("ยังไม่มีของปี 1996"));
  assert.ok(note.includes("รุ่นปีอื่น"));
  // Must not fall back to the softer "we just didn't filter by year" wording.
  assert.ok(!note.includes("ยังไม่ได้กรองตามปีรถ"));
});
