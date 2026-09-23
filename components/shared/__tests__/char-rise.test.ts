import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";
import CharRise, { splitGraphemes } from "../CharRise";

type SpanProps = { className?: string; children?: unknown };

const spanTexts = (element: ReactElement<SpanProps>): string[] => {
  const children = element.props.children;
  assert.ok(Array.isArray(children), "expected one span per character");
  return (children as ReactElement<SpanProps>[]).map((child) => String(child.props.children));
};

test("Thai vowels and tone marks stay with their base consonant", () => {
  assert.deepEqual(splitGraphemes("น้ำ"), ["น้ำ"]);
  assert.deepEqual(splitGraphemes("ที่"), ["ที่"]);
  assert.deepEqual(splitGraphemes("คอยล์เย็น"), ["ค", "อ", "ย", "ล์", "เ", "ย็", "น"]);
});

test("no span ever starts with a combining mark", () => {
  const COMBINING_THAI = /^[ัิ-ฺ็-๎]/u;
  for (const text of ["คอมเพรสเซอร์แอร์", "ศรีวรรณ อะไหล่แอร์", "หม้อน้ำ", "ชิ้นส่วน"]) {
    for (const part of splitGraphemes(text) ?? []) {
      assert.doesNotMatch(part, COMBINING_THAI, `"${part}" in "${text}" lost its base consonant`);
    }
    assert.equal((splitGraphemes(text) ?? []).join(""), text, "segmentation must be lossless");
  }
});

test("CharRise wraps grapheme clusters and keeps spaces as non-breaking spaces", () => {
  const element = CharRise({ text: "หม้อ น้ำ" }) as ReactElement<SpanProps>;
  assert.deepEqual(spanTexts(element), ["ห", "ม้", "อ", " ", "น้ำ"]);
});

test("ASCII text still animates one letter per span", () => {
  const element = CharRise({ text: "Vigo" }) as ReactElement<SpanProps>;
  assert.deepEqual(spanTexts(element), ["V", "i", "g", "o"]);
});
