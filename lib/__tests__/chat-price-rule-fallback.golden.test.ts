import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { LineIntent } from "@/lib/generated/prisma";
import { scanCarYearMentions } from "@/lib/car-year-shorthand";
import { classifyChatAiError, type ChatAiCallFailure } from "@/lib/chat-core/ai-call-failure";
import { resolveColloquialCarModelAlias } from "@/lib/chat-core/colloquial-car-model-aliases";
import {
  analyzePriceProductText,
  buildPriceProductSearchIntent,
  type PriceProductTextAnalysis,
} from "@/lib/chat-core/price-product-subjects";
import { guardChatSearchIntent } from "@/lib/chat-core/search-guards";

// Golden tests for the price-subject fallback (incident 2026-10-09, conv
// cmqyvxy5a): the Gemini classifier timed out, the deterministic price rule took
// over, collapsed "คอยล์เย็น" into a universal "ตู้แอร์" and dropped "all new" +
// "ปี 2012", and the customer was shown "ตู้แอร์ฝัง 432" hanging units although
// the shop stocks D-Max 2012 coils (P0042, P1098, P0317).
// Owner decisions 2026-10-12: fix A (hand off when the rule cannot read the car),
// B (read cars/years; a bare "all new" is always Isuzu D-Max) and D (audit every
// failed Gemini call), on LINE and Messenger.

const INCIDENT_TEXT = "คอยล์เย็น all new ปี 2012 ราคาเท่าไหร่ครับงาน ถูกสุด";

type ReadableCase = {
  text: string;
  subject: { partType: string; carBrand: string | null; carModel: string | null; year: number | null; partKind: string; query: string };
};

const READABLE: ReadableCase[] = [
  {
    text: INCIDENT_TEXT,
    subject: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "all new", year: 2012, partKind: "fitment", query: "คอยล์เย็น D-Max 2012" },
  },
  {
    text: "คอยเย็นอีซูซุออนิวปี12ราคา",
    subject: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "ออนิว", year: 2012, partKind: "fitment", query: "คอยล์เย็น D-Max 2012" },
  },
  {
    text: "คอยล์เย็น all new ปี 2555 ราคา",
    subject: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "all new", year: 2012, partKind: "fitment", query: "คอยล์เย็น D-Max 2012" },
  },
  {
    text: "คอยล์เย็น ออนิว 2012-2015 ราคา",
    subject: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "ออนิว", year: 2012, partKind: "fitment", query: "คอยล์เย็น D-Max 2012" },
  },
  {
    // The catalog name itself becomes the canonical model.
    text: "คอยเย็น d-max ปี2015 ราคาเท่าไหร่ครับ",
    subject: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "D-Max", year: 2015, partKind: "fitment", query: "คอยล์เย็น D-Max 2015" },
  },
  {
    text: "ตู้แอร์วีโก้ราคาเท่าไหร่",
    subject: { partType: "ตู้แอร์", carBrand: "Toyota", carModel: "วีโก้", year: null, partKind: "fitment", query: "ตู้แอร์ Hilux Vigo" },
  },
  {
    // No car: a coil stays a fitment part so the gate asks which car.
    text: "คอยเย็นราคาประมาณเท่าไหร่",
    subject: { partType: "คอยล์เย็น", carBrand: null, carModel: null, year: null, partKind: "fitment", query: "คอยล์เย็น" },
  },
  {
    // Unchanged: a bare ตู้แอร์ ask is the universal hanging unit.
    text: "ตู้แอร์ ราคาเท่าไหร่ครับ",
    subject: { partType: "ตู้แอร์", carBrand: null, carModel: null, year: null, partKind: "universal", query: "ตู้แอร์" },
  },
  {
    // A price is not a year.
    text: "คอยเย็น ราคา 2000 บาท ได้ไหม",
    subject: { partType: "คอยล์เย็น", carBrand: null, carModel: null, year: null, partKind: "fitment", query: "คอยล์เย็น" },
  },
];

const UNREADABLE: Array<{ text: string; unreadable: PriceProductTextAnalysis["unreadable"] }> = [
  {
    text: "คอยเย็น vios 2010 ลดได้ไหม",
    unreadable: { reason: "UNREADABLE_VEHICLE", partType: "คอยล์เย็น", vehicleMention: "vios", year: 2010 },
  },
  {
    // The nickname belongs to Isuzu; with Toyota named it is not a D-Max.
    text: "คอยเย็น toyota all new ราคา",
    unreadable: { reason: "UNREADABLE_VEHICLE", partType: "คอยล์เย็น", vehicleMention: "toyota all new", year: null },
  },
  {
    text: "คอยเย็น isuzu ราคา",
    unreadable: { reason: "UNREADABLE_VEHICLE", partType: "คอยล์เย็น", vehicleMention: "isuzu", year: null },
  },
  {
    text: "คอยเย็น vigo revo ราคา",
    unreadable: { reason: "AMBIGUOUS_VEHICLE", partType: "คอยล์เย็น", vehicleMention: "vigo / revo", year: null },
  },
  {
    // "ปี 55" is usually พ.ศ. 2555 (= 2012) but could be 1955 — never guessed.
    text: "คอยเย็น isuzu all new ปี 55 ราคา",
    unreadable: { reason: "AMBIGUOUS_YEAR", partType: "คอยล์เย็น", vehicleMention: "all new", year: null },
  },
  {
    text: "คอยล์เย็น all new ปี 2012 หรือ ปี 2013 ราคา",
    unreadable: { reason: "AMBIGUOUS_YEAR", partType: "คอยล์เย็น", vehicleMention: "all new", year: null },
  },
  {
    text: "ตู้แอร์ commuter ราคา",
    unreadable: { reason: "UNREADABLE_VEHICLE", partType: "ตู้แอร์", vehicleMention: "commuter", year: null },
  },
];

test("golden: the incident turn and its variants read the car and year instead of a universal ตู้แอร์", () => {
  for (const golden of READABLE) {
    const analysis = analyzePriceProductText(golden.text);
    assert.equal(analysis.unreadable, null, golden.text);
    assert.deepEqual(analysis.subjects, [golden.subject], golden.text);
  }
});

test("golden: a cooling part next to a car or year the rule cannot read is refused, never searched", () => {
  for (const golden of UNREADABLE) {
    const analysis = analyzePriceProductText(golden.text);
    assert.deepEqual(analysis.subjects, [], golden.text);
    assert.deepEqual(analysis.unreadable, golden.unreadable, golden.text);
  }
});

test("golden: earlier price-rule fixes still hold", () => {
  // 2026-07-25: รถตู้ (a van) and component asks never become a cooling unit.
  assert.deepEqual(
    analyzePriceProductText("สวัสดีครับขออนุญาตสอบถามแผงแอร์รถตู้ commuter หน้าสั้นปี 2013\nแผงแอร์หน้าครับ\nราคาประมาณเท่าไหร่ครับ"),
    { subjects: [], unreadable: null },
  );
  assert.deepEqual(analyzePriceProductText("มอเตอร์ตู้แอร์ vigo ราคาเท่าไหร่"), { subjects: [], unreadable: null });
  // 2026-07-09: one Messenger message, three subjects.
  const threeSubjects = analyzePriceProductText(
    "ตู้วีโก้คลูเกีรยคับน้ำDENSO250ccราคาคับ\nน้ำมัน\nที่ร้านมีน้ำยาแอร์ของอะไรคับขอราคาด้วยคับ",
  );
  assert.equal(threeSubjects.unreadable, null);
  assert.deepEqual(
    threeSubjects.subjects.map((subject) => subject.query),
    ["ตู้แอร์ Hilux Vigo", "น้ำมัน DENSO 250cc", "น้ำยาแอร์"],
  );
});

test("golden: the rule's car survives the evidence guard and resolves through the shared alias table", () => {
  const cases = [
    { text: INCIDENT_TEXT, brandName: "Isuzu", modelName: "D-Max" },
    { text: "ตู้แอร์วีโก้ราคาเท่าไหร่", brandName: "Toyota", modelName: "Hilux Vigo" },
  ];
  for (const golden of cases) {
    const intent = buildPriceProductSearchIntent(analyzePriceProductText(golden.text).subjects);
    const guarded = guardChatSearchIntent({ intent, latestText: golden.text, history: [] }).intent;
    assert.equal(guarded?.carBrand, golden.brandName, golden.text);
    assert.ok(guarded?.carModel, golden.text);
    assert.equal(guarded?.year, intent?.year, golden.text);
    assert.deepEqual(
      resolveColloquialCarModelAlias({ carBrand: guarded?.carBrand, carModel: guarded?.carModel }),
      { brandName: golden.brandName, modelName: golden.modelName },
      golden.text,
    );
  }
});

test("golden: car-year scanning", () => {
  const years = (text: string) => scanCarYearMentions(text);
  assert.deepEqual(years("ปี 2012").years.map((m) => m.year), [2012]);
  assert.deepEqual(years("ราคาปี12").years.map((m) => m.year), [2012]);
  assert.deepEqual(years("ปี2560").years.map((m) => m.year), [2017], "พ.ศ.");
  assert.deepEqual(years("ปี96").years.map((m) => m.year), [1996]);
  assert.deepEqual(years("12-15").years.map((m) => m.year), [2012], "a range reports its start");
  assert.deepEqual(years("2012-2015").years.map((m) => m.year), [2012]);
  assert.equal(years("ปี 55").ambiguous, true);
  assert.deepEqual(years("2000 บาท").years, []);
  assert.deepEqual(years("ราคา 2000").years, []);
  assert.deepEqual(years("2000cc").years, []);
  assert.deepEqual(years("STE-1170").years, [], "part codes are not years");
  assert.deepEqual(years("250cc").years, []);
});

test("golden: Gemini errors map to a failure kind, with API keys redacted", () => {
  const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const cases: Array<{ error: unknown; kind: ChatAiCallFailure["kind"] }> = [
    { error: new Error("ALL_GEMINI_KEYS_FAILED:This operation was aborted"), kind: "TIMEOUT" },
    { error: abort, kind: "TIMEOUT" },
    { error: new Error("ALL_GEMINI_KEYS_FAILED:GEMINI_HTTP_429:quota"), kind: "RATE_LIMITED" },
    { error: new Error("ALL_GEMINI_KEYS_FAILED:GEMINI_HTTP_504:Gateway timeout"), kind: "SERVER_ERROR" },
    { error: new Error("ALL_GEMINI_KEYS_FAILED:GEMINI_HTTP_403:denied"), kind: "KEY_REJECTED" },
    { error: new Error("ALL_GEMINI_KEYS_COOLING_DOWN_OR_DISABLED"), kind: "KEYS_UNAVAILABLE" },
    { error: new Error("NO_GEMINI_KEYS_CONFIGURED"), kind: "NO_KEYS" },
    { error: new Error("GEMINI_REQUEST_ERROR:GEMINI_HTTP_400:bad"), kind: "REQUEST_ERROR" },
    { error: new Error("ALL_GEMINI_KEYS_FAILED:fetch failed"), kind: "NETWORK" },
    { error: "weird", kind: "UNKNOWN" },
  ];
  for (const golden of cases) {
    assert.equal(classifyChatAiError(golden.error).kind, golden.kind, String(golden.error));
  }
  const leaked = classifyChatAiError(new Error("fetch failed for ?key=AIzaSySECRET123456789&alt=json"));
  assert.doesNotMatch(leaked.detail ?? "", /AIzaSySECRET/);
});

// ── D: ai-service reports why each chat Gemini call produced nothing ──────────
let geminiBehaviour: () => Promise<{ text: string; keyRef: string }> = async () => ({ text: "", keyRef: "k" });

before(async () => {
  await mock.module("@/lib/google-ai-client", {
    namedExports: { generateGeminiContent: async () => geminiBehaviour() },
  });
  await mock.module("@/lib/google-ai-keys", {
    namedExports: { hasGeminiKeysConfigured: () => true },
  });
});

test("golden: a timed-out classifier is reported and still returns null (rule fallback)", async () => {
  const { extractChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const failures: ChatAiCallFailure[] = [];
  geminiBehaviour = async () => {
    throw new Error("ALL_GEMINI_KEYS_FAILED:This operation was aborted");
  };

  const intent = await extractChatSearchIntent({
    intent: LineIntent.PURCHASE_INTENT,
    latestText: INCIDENT_TEXT,
    history: [],
    onFailure: (failure) => failures.push(failure),
  });

  assert.equal(intent, null);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.stage, "classify");
  assert.equal(failures[0]?.kind, "TIMEOUT");
});

test("golden: an unparseable classifier reply is reported without storing the customer's words", async () => {
  const { extractChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const failures: ChatAiCallFailure[] = [];
  geminiBehaviour = async () => ({ text: '{"group": "product", "query": "คอยล์เย็น', keyRef: "k" });

  const intent = await extractChatSearchIntent({
    intent: LineIntent.PRODUCT_INQUIRY_TEXT,
    latestText: "คอยล์เย็น vios ราคา (cut-off reply)",
    history: [],
    onFailure: (failure) => failures.push(failure),
  });

  assert.equal(intent, null);
  assert.equal(failures[0]?.kind, "UNPARSEABLE");
  assert.match(failures[0]?.detail ?? "", /^replyChars=\d+$/);
});

test("golden: a failed product reply is reported and the template reply is returned", async () => {
  const { generateChatSuggestion } = await import("@/lib/chat-core/ai-service");
  const failures: ChatAiCallFailure[] = [];
  geminiBehaviour = async () => {
    throw new Error("ALL_GEMINI_KEYS_FAILED:GEMINI_HTTP_503:overloaded");
  };

  const draft = await generateChatSuggestion({
    intent: LineIntent.PRODUCT_INQUIRY_TEXT,
    originalText: INCIDENT_TEXT,
    productSearch: {
      searched: true,
      reason: "SEARCHED_PRODUCT_INQUIRY",
      query: "คอยล์เย็น D-Max 2012",
      result: { ids: ["p0042"], total: 1, mode: "v2" },
      needsMoreInfo: false,
      appliedFilters: { categoryName: "คอยล์เย็น (Evaporator)", carBrandName: "Isuzu", carModelName: "D-Max", fitmentYear: 2012 },
      droppedImageCodes: [],
      didYouMean: null,
    },
    products: [{ name: "คอยล์เย็น Isuzu D-Max 2012-2018 / MU-X 2013-2019 STAL STE-1170", code: "P0042", salePrice: 950 }],
    onFailure: (failure) => failures.push(failure),
  });

  assert.match(draft.suggestedReply, /P0042/, "the customer still gets the deterministic list");
  assert.equal(failures[0]?.stage, "reply");
  assert.equal(failures[0]?.kind, "SERVER_ERROR");
});
