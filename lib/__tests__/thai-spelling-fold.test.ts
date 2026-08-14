import test from "node:test";
import assert from "node:assert/strict";

import {
  foldThaiSpelling,
  foldedThaiEquals,
  needsThaiTypingRepair,
  repairThaiTyping,
} from "@/lib/thai-spelling-fold";

test("folds the typing slips it is meant to fold", () => {
  const cases: Array<[string, string]> = [
    ["วีโก้", "วีโก"], // tone mark dropped
    ["คอยล์เย็น", "คอยลเยน"], // thanthakhat + maitaikhu
    ["วาล์วแอร์", "วาลวแอร"],
    ["คอมมมแอร์", "คอมแอร"], // 3+ repeat collapses
    ["ต่างๆ", "ตาง"], // mai yamok carries no lexical content
    ["R134a", "r134a"], // Latin part codes are only lowercased
    ["STA-7065", "sta-7065"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(foldThaiSpelling(input), expected, input);
  }
});

test("unifies the two ways of typing ำ, including with a tone mark between", () => {
  // น้ำ = น + ้ + ำ  vs  นํ้า = น + ํ + ้ + า — visually identical, different bytes.
  // The tone mark sitting BETWEEN the two halves is why the fold must strip tone
  // marks BEFORE joining nikhahit + sara aa.
  assert.equal(foldThaiSpelling("น้ำ"), foldThaiSpelling("นํ้า"));
  assert.equal(foldThaiSpelling("น้ำยาล้างคอยล์"), foldThaiSpelling("นํ้ายาลางคอยล"));
  assert.equal(foldThaiSpelling("หม้อน้ำ"), foldThaiSpelling("หมอนํ้า"));
});

test("keeps genuinely different words apart", () => {
  // The fold must never merge two real parts — that would turn a recall win into a
  // wrong answer.
  const distinct = [
    ["หม้อน้ำ", "คอยล์เย็น"],
    ["คอมแอร์", "คอนเดนเซอร์"],
    ["กรองแอร์", "กรองอากาศ"],
    ["วาล์วแอร์", "วาล์วน้ำ"],
    ["แผงแอร์", "แผงร้อน"],
  ];
  for (const [a, b] of distinct) {
    assert.notEqual(foldThaiSpelling(a), foldThaiSpelling(b), `${a} vs ${b}`);
  }
});

test("a doubled letter is NOT collapsed (real Thai words contain them)", () => {
  assert.equal(foldThaiSpelling("นกกระ"), "นกกระ");
  assert.equal(foldThaiSpelling("จัดดี"), "จัดดี");
});

test("is idempotent", () => {
  for (const value of ["คอยล์เย็นน้ำ", "นํ้ายา", "คอมมมแอร์", "R134a"]) {
    assert.equal(foldThaiSpelling(foldThaiSpelling(value)), foldThaiSpelling(value), value);
  }
});

test("repairThaiTyping produces CORRECTLY SPELLED Thai, not a folded form", () => {
  // This is the whole contract: the search index stores raw catalog text, so the
  // repaired query must be a string the catalog can actually contain. Folding here
  // instead measured 26 → 0 results against the live catalog.
  assert.equal(repairThaiTyping("ท่อยางหม้อนํ้า"), "ท่อยางหม้อน้ำ");
  assert.equal(repairThaiTyping("นํ้ายาล้างคอยล์"), "น้ำยาล้างคอยล์");
  assert.equal(repairThaiTyping("นํายา"), "นำยา");
  assert.equal(repairThaiTyping("คอมมมแอร์"), "คอมแอร์");

  // Tone marks, vowels, thanthakhat and case all SURVIVE — unlike the fold.
  assert.equal(repairThaiTyping("คอยล์เย็น"), "คอยล์เย็น");
  assert.equal(repairThaiTyping("วีโก้"), "วีโก้");
  assert.equal(repairThaiTyping("R134a"), "R134a");
});

test("repairThaiTyping is idempotent and leaves correct text untouched", () => {
  for (const value of ["ท่อยางหม้อน้ำ", "คอยล์เย็น", "หม้อน้ำ d-max", "STA-7065"]) {
    assert.equal(repairThaiTyping(value), value, value);
  }
  assert.equal(repairThaiTyping(repairThaiTyping("นํ้ายา")), repairThaiTyping("นํ้ายา"));
});

test("needsThaiTypingRepair fires ONLY on slips trigram cannot bridge", () => {
  // Worth an extra search: the decomposed ำ shifts every trigram spanning it, and a
  // 3+ repeat pads the string below the similarity floor.
  assert.equal(needsThaiTypingRepair("นํ้ายาล้างคอยล์"), true, "decomposed ำ");
  assert.equal(needsThaiTypingRepair("นํายา"), true, "decomposed ำ without a tone mark");
  assert.equal(needsThaiTypingRepair("คอมมมแอร์"), true, "tripled character");

  // NOT worth an extra search — the engine already recovers these (PLAN.md
  // 2026-08-03 measured ไดรเออร์↔ไดเออร์ at 100% via trigram alone). Retrying would
  // cost a query on the slowest turn and find exactly what was already found.
  assert.equal(needsThaiTypingRepair("วีโก"), false, "plain dropped tone mark");
  assert.equal(needsThaiTypingRepair("คอยล์เย็น"), false);
  assert.equal(needsThaiTypingRepair("น้ำยาล้างคอยล์"), false, "correctly-typed ำ");
  assert.equal(needsThaiTypingRepair("หม้อน้ำ d-max"), false);
  assert.equal(needsThaiTypingRepair("นกกระ"), false, "a doubled letter is not a repeat run");
  assert.equal(needsThaiTypingRepair("compressor vios"), false);
  assert.equal(needsThaiTypingRepair(""), false);
  assert.equal(needsThaiTypingRepair(null), false);
});

test("foldedThaiEquals compares on the folded form", () => {
  assert.equal(foldedThaiEquals("โอนแล้ว", "โอนแลว"), true);
  assert.equal(foldedThaiEquals("เคลม", "สลิป"), false);
  assert.equal(foldedThaiEquals("", "อะไร"), false);
});
