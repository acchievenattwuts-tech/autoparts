import test from "node:test";
import assert from "node:assert/strict";

import {
  isStageableVehicleSpelling,
  vehicleSpellingCollidesWithPart,
  vehicleSpellingIsAlreadyKnown,
} from "@/lib/chat-core/vehicle-synonym-guardrails";

test("accepts the shapes real car model spellings take", () => {
  // Digits and a hyphen are legitimate here (unlike category aliases, which ban
  // digits) because model names genuinely contain them.
  for (const value of ["ฟอจูเนอ", "ดีแม็ค", "D-Max", "BT-50", "MG 3", "CX-5", "วีโก"]) {
    assert.equal(isStageableVehicleSpelling(value), true, value);
  }
});

test("rejects junk that must never become a vehicle spelling", () => {
  const junk = [
    "",
    "  ",
    "ab", // shorter than the minimum
    "2015", // a year
    "2 5 0 0", // engine displacement typed with spaces
    "!!!",
    "🚗🚗",
    "รถ รุ่น อะไร ก็ ได้ ที่ ยาว มาก เกิน สี่ สิบ ตัว อักษร แน่ ๆ เลย ครับ",
  ];
  for (const value of junk) {
    assert.equal(isStageableVehicleSpelling(value), false, JSON.stringify(value));
  }
});

test("a spelling that is ALREADY a known vehicle is not a typo", () => {
  // The worst failure this feature could cause: aliasing one real vehicle to
  // another. "Vios" is a real model, so it must never be staged as a synonym of
  // something else, no matter what the LLM proposed.
  const known = ["Vios", "D-Max", "วีออส", "Fortuner"];
  assert.equal(vehicleSpellingIsAlreadyKnown("Vios", known), true);
  assert.equal(vehicleSpellingIsAlreadyKnown("vios", known), true, "case-insensitive");
  assert.equal(vehicleSpellingIsAlreadyKnown("วีออส", known), true, "Thai spelling counts");
  assert.equal(vehicleSpellingIsAlreadyKnown("ฟอจูเนอ", known), false, "a real typo passes");
  assert.equal(vehicleSpellingIsAlreadyKnown("", known), true, "empty is rejected");
});

test("a PART word must never become a vehicle synonym", () => {
  // "คอยล์เย็น" resolving to a car model would hard-filter every future search for
  // that part to one vehicle.
  const parts = ["คอยล์เย็น (Evaporator)", "หม้อน้ำ (Radiator)", "คอมแอร์"];
  assert.equal(vehicleSpellingCollidesWithPart("คอยล์เย็น", parts), true);
  assert.equal(vehicleSpellingCollidesWithPart("คอมแอร์", parts), true);
  assert.equal(
    vehicleSpellingCollidesWithPart("หม้อน้ำ (Radiator)", parts),
    true,
    "exact category name",
  );
  assert.equal(vehicleSpellingCollidesWithPart("ฟอจูเนอ", parts), false, "a real model passes");
});

// ── Attempt de-duplication ───────────────────────────────────────────────────

test("the same text does not buy a second LLM attempt inside the window", async () => {
  const { shouldSkipVehicleSpellingAttempt, clearVehicleSynonymAttemptCache } = await import(
    "@/lib/chat-core/vehicle-synonym-attempt-cache"
  );
  clearVehicleSynonymAttemptCache();

  const now = 1_000_000;
  // Production shows customers retyping the same message 2-3 times in a row.
  assert.equal(shouldSkipVehicleSpellingAttempt("คอมแอร์ ฟอจูเนอ", now), false, "first attempt runs");
  assert.equal(shouldSkipVehicleSpellingAttempt("คอมแอร์ ฟอจูเนอ", now + 1_000), true, "repeat skipped");
  // Normalization means casing/whitespace variants share the window.
  assert.equal(shouldSkipVehicleSpellingAttempt("คอมแอร์  ฟอจูเนอ", now + 2_000), true);
  // A different message is unaffected.
  assert.equal(shouldSkipVehicleSpellingAttempt("หม้อน้ำ ดีแม็ค", now + 3_000), false);
  // The window expires.
  assert.equal(
    shouldSkipVehicleSpellingAttempt("คอมแอร์ ฟอจูเนอ", now + 11 * 60_000),
    false,
    "window expired",
  );
  // Empty text is always skipped (nothing to correct).
  assert.equal(shouldSkipVehicleSpellingAttempt("", now), true);
  assert.equal(shouldSkipVehicleSpellingAttempt(null, now), true);
});
