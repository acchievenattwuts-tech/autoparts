import test from "node:test";
import assert from "node:assert/strict";

import {
  extractPriceProductSubjectsFromText,
  buildPriceProductSearchIntent,
} from "@/lib/chat-core/price-product-subjects";

test("รถตู้ (a van) never extracts a cooling-unit subject", () => {
  // Regression (production 2026-07-25, conv cmq4ziq6l): the coalesced price turn
  // "แผงแอร์รถตู้ commuter หน้าสั้นปี 2013 … ราคาประมาณเท่าไหร่ครับ" matched the
  // old bare-"ตู้" alternative → subject partType "ตู้แอร์" (universal) overrode
  // the LLM classifier → answered hanging cooling units instead of condensers.
  const subjects = extractPriceProductSubjectsFromText(
    "สวัสดีครับขออนุญาตสอบถามแผงแอร์รถตู้ commuter หน้าสั้นปี 2013\nแผงแอร์หน้าครับ\nราคาประมาณเท่าไหร่ครับ",
  );
  assert.deepEqual(subjects, []);
  assert.equal(buildPriceProductSearchIntent(subjects), null);
});

test("รถตู้แอร์ไม่เย็น (van AC complaint) does not extract a cooling-unit subject", () => {
  assert.deepEqual(extractPriceProductSubjectsFromText("รถตู้แอร์ไม่เย็น ราคาซ่อมเท่าไหร่"), []);
});

test("a real ตู้แอร์ ask still extracts the cooling-unit subject", () => {
  const subjects = extractPriceProductSubjectsFromText("ตู้แอร์ ราคาเท่าไหร่ครับ");
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].partType, "ตู้แอร์");
  assert.equal(subjects[0].partKind, "universal");
});

test("ตู้แอร์ + วีโก้ still locks the Vigo fitment subject", () => {
  const subjects = extractPriceProductSubjectsFromText("ตู้แอร์วีโก้ราคาเท่าไหร่");
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].carModel, "Vigo");
  assert.equal(subjects[0].partKind, "fitment");
});

test("คอยเย็น colloquial still extracts the cooling-unit subject", () => {
  const subjects = extractPriceProductSubjectsFromText("คอยเย็นราคาประมาณเท่าไหร่");
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].partType, "ตู้แอร์");
});

test("น้ำยาแอร์ ask still extracts the refrigerant subject", () => {
  const subjects = extractPriceProductSubjectsFromText("น้ำยาแอร์ราคาเท่าไหร่");
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].partType, "น้ำยาแอร์");
});

test("น้ำมัน DENSO ask still extracts the oil subject", () => {
  const subjects = extractPriceProductSubjectsFromText("น้ำมัน denso 135cc ราคา");
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].partType, "น้ำมัน");
  assert.equal(subjects[0].query, "น้ำมัน DENSO 135cc");
});
