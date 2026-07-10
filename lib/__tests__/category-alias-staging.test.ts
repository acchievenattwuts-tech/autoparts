import test from "node:test";
import assert from "node:assert/strict";

import {
  isStageableAliasText,
  aliasCollidesWithVehicle,
} from "@/lib/chat-core/category-alias-guardrails";

test("isStageableAliasText: accepts a normal Thai part word", () => {
  assert.equal(isStageableAliasText("วาว์ล"), true);
  assert.equal(isStageableAliasText("คอยล์เย็น"), true);
  assert.equal(isStageableAliasText("evaporator"), true);
});

test("isStageableAliasText: rejects junk (too short, digits, punctuation, too long)", () => {
  assert.equal(isStageableAliasText("ว"), false); // too short
  assert.equal(isStageableAliasText("วาว์ล03"), false); // contains digits
  assert.equal(isStageableAliasText("วาว์ล!!!"), false); // punctuation
  assert.equal(isStageableAliasText("  "), false); // blank
  assert.equal(isStageableAliasText("a".repeat(41)), false); // too long
  assert.equal(isStageableAliasText(null), false);
});

test("isStageableAliasText: allows a single internal space", () => {
  assert.equal(isStageableAliasText("วาล์ว แอร์"), true);
  assert.equal(isStageableAliasText("วาล์ว  แอร์"), false); // double space
});

test("aliasCollidesWithVehicle: flags a term that shadows a car model/brand", () => {
  const vehicles = ["Hiace Commuter", "Altis", "Toyota", "Vigo"];
  assert.equal(aliasCollidesWithVehicle("com", vehicles), true); // substring of commuter
  assert.equal(aliasCollidesWithVehicle("altis", vehicles), true); // equals a model
  assert.equal(aliasCollidesWithVehicle("วาว์ล", vehicles), false); // safe part word
});
