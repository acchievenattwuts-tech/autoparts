import test from "node:test";
import assert from "node:assert/strict";

import {
  boundMessagesToSession,
  isFrameStale,
  reconcileInquiryFrame,
  buildFrameQuery,
  SESSION_IDLE_MS,
  type InquiryFrame,
} from "@/lib/chat-core/inquiry-frame";

const frame = (over: Partial<InquiryFrame> = {}): InquiryFrame => ({
  partType: null,
  carBrand: null,
  carModel: null,
  year: null,
  ...over,
});

const at = (msAgo: number) => ({ createdAt: new Date(Date.now() - msAgo) });

test("boundMessagesToSession cuts at a gap longer than the idle window", () => {
  const msgs = [
    at(300 * 60_000), // old session
    at(290 * 60_000),
    at(5 * 60_000), // new session (gap 285 min > 120)
    at(2 * 60_000),
    at(0),
  ];
  const kept = boundMessagesToSession(msgs);
  assert.equal(kept.length, 3, "only the current session's 3 messages remain");
});

test("boundMessagesToSession keeps everything when there is no long gap", () => {
  const msgs = [at(10 * 60_000), at(6 * 60_000), at(1 * 60_000), at(0)];
  assert.equal(boundMessagesToSession(msgs).length, 4);
});

test("isFrameStale: null or older than idle window is stale", () => {
  assert.equal(isFrameStale(null), true);
  assert.equal(isFrameStale(new Date(Date.now() - SESSION_IDLE_MS - 1000)), true);
  assert.equal(isFrameStale(new Date(Date.now() - 60_000)), false);
});

test("level 3 merge: drip-fed detail fills the frame", () => {
  const prev = frame({ partType: "หม้อน้ำ", carModel: "D-Max" });
  const latest = frame({ year: 2003 });
  const { frame: merged, topicShift } = reconcileInquiryFrame(prev, latest, { sessionStale: false });
  assert.equal(topicShift, false);
  assert.deepEqual(merged, { partType: "หม้อน้ำ", carBrand: null, carModel: "D-Max", year: 2003 });
});

test("level 2 topic-shift: a new part type replaces the part but keeps the car", () => {
  const prev = frame({ partType: "หม้อน้ำ", carModel: "D-Max", year: 2003 });
  const latest = frame({ partType: "คอยล์เย็น" });
  const { frame: next, topicShift } = reconcileInquiryFrame(prev, latest, { sessionStale: false });
  assert.equal(topicShift, true, "different part = topic shift");
  assert.equal(next.partType, "คอยล์เย็น", "part replaced");
  assert.equal(next.carModel, "D-Max", "vehicle kept within session");
  assert.equal(next.year, 2003);
});

test("level 1 stale session: previous frame is ignored", () => {
  const prev = frame({ partType: "หม้อน้ำ", carModel: "D-Max", year: 2003 });
  const latest = frame({ partType: "คอยล์เย็น" });
  const { frame: next } = reconcileInquiryFrame(prev, latest, { sessionStale: true });
  assert.deepEqual(next, { partType: "คอยล์เย็น", carBrand: null, carModel: null, year: null });
});

test("switching to a new car model drops the carried-over brand/year", () => {
  // The production bug: prior turns were Toyota Vigo; the customer then asks about
  // a new vehicle ("คอมแอร์ Mu-x") supplying only the model. The stale "Toyota"
  // brand must NOT stick to the new Isuzu model.
  const prev = frame({ partType: "คอมแอร์", carBrand: "Toyota", carModel: "Vigo", year: 2010 });
  const latest = frame({ carModel: "MU-X" });
  const { frame: next } = reconcileInquiryFrame(prev, latest, { sessionStale: false });
  assert.equal(next.carModel, "MU-X");
  assert.equal(next.carBrand, null, "stale brand cleared on model switch");
  assert.equal(next.year, null, "stale year cleared on model switch");
});

test("a new model that arrives WITH a brand keeps that brand", () => {
  const prev = frame({ partType: "คอมแอร์", carBrand: "Toyota", carModel: "Vigo", year: 2010 });
  const latest = frame({ carBrand: "Isuzu", carModel: "D-Max" });
  const { frame: next } = reconcileInquiryFrame(prev, latest, { sessionStale: false });
  assert.equal(next.carBrand, "Isuzu");
  assert.equal(next.carModel, "D-Max");
});

test("same model across turns keeps the carried brand/year", () => {
  const prev = frame({ partType: "คอมแอร์", carBrand: "Isuzu", carModel: "D-Max", year: 2012 });
  const latest = frame({ partType: "คอยล์เย็น", carModel: "D-Max" });
  const { frame: next } = reconcileInquiryFrame(prev, latest, { sessionStale: false });
  assert.equal(next.carBrand, "Isuzu", "brand retained when model unchanged");
  assert.equal(next.year, 2012);
});

test("stale-part guard: misspelled new part + car switch drops the carried part", () => {
  // Production bug (2026-07-10): prior turn "หม้อน้ำ commuter" set partType=หม้อน้ำ.
  // Next message "วาว์ลอัลติสแท้03" (วาล์วแอร์ Altis) switched the car AND named a
  // new part, but "วาว์ล" failed literal grounding so latest.partType is null. The
  // carried "หม้อน้ำ" must be dropped, not inherited — otherwise the query gets
  // hard-filtered to Radiator and returns หม้อน้ำ instead of วาล์ว.
  const prev = frame({ partType: "หม้อน้ำ (Radiator)", carModel: "Hiace Commuter" });
  const latest = frame({ partType: null, carModel: "Altis", year: 2003 });
  const { frame: next, droppedStalePart } = reconcileInquiryFrame(prev, latest, {
    sessionStale: false,
    latestClassifierPartType: "วาล์วแอร์",
  });
  assert.equal(droppedStalePart, true);
  assert.equal(next.partType, null, "stale radiator part dropped on car switch + new part");
  assert.equal(next.carModel, "Altis");
  assert.equal(next.year, 2003);
});

test("stale-part guard: pure vehicle-only follow-up keeps the carried part", () => {
  // "แล้ว Vigo ล่ะ" — the customer switched car but named NO part this turn, so the
  // classifier reports no new part (or the same carried one). Keep the carried part.
  const prev = frame({ partType: "คอยล์เย็น", carModel: "D-Max", year: 2012 });
  const latest = frame({ partType: null, carModel: "Vigo" });
  const { frame: next, droppedStalePart } = reconcileInquiryFrame(prev, latest, {
    sessionStale: false,
    latestClassifierPartType: null,
  });
  assert.equal(droppedStalePart, false);
  assert.equal(next.partType, "คอยล์เย็น", "part retained for vehicle-only follow-up");
  assert.equal(next.carModel, "Vigo");
});

test("stale-part guard: same car + no new part keeps the carried part (drip-feed)", () => {
  const prev = frame({ partType: "หม้อน้ำ", carModel: "Altis" });
  const latest = frame({ partType: null, carModel: "Altis", year: 2003 });
  const { frame: next, droppedStalePart } = reconcileInquiryFrame(prev, latest, {
    sessionStale: false,
    latestClassifierPartType: "หม้อน้ำ",
  });
  assert.equal(droppedStalePart, false, "no car switch → nothing dropped");
  assert.equal(next.partType, "หม้อน้ำ");
  assert.equal(next.year, 2003);
});

test("buildFrameQuery joins part + car, excludes the year", () => {
  assert.equal(buildFrameQuery(frame({ partType: "หม้อน้ำ", carModel: "D-Max", year: 2003 })), "หม้อน้ำ D-Max");
  assert.equal(buildFrameQuery(frame()), null);
});
