import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateChatModelGroundingCandidate,
  guardChatSearchIntent,
  lineValueHasCustomerTypoEvidence,
  resolveLatestExplicitCarModelEvidence,
} from "@/lib/chat-core/search-guards";
import { buildCarModelGroundingLookup } from "@/lib/car-model-alias-cache";
import type { ChatSearchIntent } from "@/lib/chat-core/ai-service";

test("typo evidence: a misspelled part word in the customer text counts as evidence", () => {
  // Real case: customer typed "คอล์ยเย็น" (ล/ย swapped); the classifier corrected it
  // to "คอยล์เย็น". The corrected part must still be recognised as customer-typed.
  assert.equal(
    lineValueHasCustomerTypoEvidence("คอยล์เย็น", "คอล์ยเย็นนิสสันมาร์ค", []),
    true,
  );
  // Exact spelling obviously matches too.
  assert.equal(lineValueHasCustomerTypoEvidence("คอยล์เย็น", "คอยล์เย็น march", []), true);
});

test("typo evidence: a hallucinated part (no such word in the text) is NOT evidence", () => {
  // Vehicle-only follow-up — the customer never typed a part; the classifier's
  // "คอยล์เย็น" would be a hallucination and must stay ungrounded.
  assert.equal(
    lineValueHasCustomerTypoEvidence("คอยล์เย็น", "vios gen3 ปี2013", []),
    false,
  );
});

const baseIntent = (over: Partial<ChatSearchIntent>): ChatSearchIntent => ({
  group: "product",
  query: "วาล์วแอร์ 134",
  isProductQuery: true,
  partType: "วาล์วแอร์",
  carBrand: "Toyota",
  carModel: "Yaris",
  year: 2008,
  partKind: null,
  tooBroad: false,
  ...over,
});

test("drops a year the customer never typed in this session", () => {
  // "ปี08" in history is NOT evidence for the 4-digit year 2008 → must be gated
  // off so it can't hard-filter a fresh query to the wrong year.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({}),
    latestText: "วาล์ว โตโยต้า 134",
    history: [{ role: "customer", text: "พัดลมโบยาริสปี08" }],
  });
  assert.equal(intent?.year, null); // "ปี08" never grounds the 4-digit 2008
  assert.equal(intent?.carBrand, "Toyota"); // Thai "โตโยต้า" grounds the English brand
  assert.equal(intent?.carModel, null); // "Yaris" not in this turn's text
});

test("Thai brand name grounds the English classifier value", () => {
  for (const [thai, eng] of [["นิสสัน", "Nissan"], ["อีซูซุ", "Isuzu"], ["ฮอนด้า", "Honda"]] as const) {
    const { intent } = guardChatSearchIntent({
      intent: baseIntent({ carBrand: eng, carModel: null, query: `วาล์วแอร์ 134` }),
      latestText: `วาล์ว ${thai} 134`,
      history: [],
    });
    assert.equal(intent?.carBrand, eng, `${thai} → ${eng}`);
  }
});

test("does not ground a brand the customer did not mention", () => {
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ carBrand: "Toyota", carModel: null, query: "วาล์วแอร์ 134" }),
    latestText: "วาล์ว นิสสัน 134", // customer said Nissan, classifier wrongly said Toyota
    history: [],
  });
  assert.equal(intent?.carBrand, null);
});

test("keeps a year the customer actually typed", () => {
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "วาล์วแอร์ 2008 134" }),
    latestText: "วาล์ว 2008 134",
    history: [],
  });
  assert.equal(intent?.year, 2008);
});

test("drops ungrounded brand/year even without a required token", () => {
  // A plain Thai part word with no numeric anchor: the classifier's brand + year
  // (Toyota 2008) are pure hallucinations — the customer only typed the part. They
  // must be dropped so they can't hard-filter the search to the wrong brand/year
  // (they would otherwise also seed the LINE inquiry frame). The MODEL is left
  // alone here by design — model transliteration ("วีโก้"↔"Vigo") isn't in the
  // evidence data, so dropping it on a plain Thai turn would discard a model the
  // customer really typed.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "วาล์วแอร์" }),
    latestText: "วาล์วแอร์",
    history: [],
  });
  assert.equal(intent?.year, null);
  assert.equal(intent?.carBrand, null);
  assert.equal(intent?.partType, "วาล์วแอร์"); // part word is untouched
});

test("keeps a Thai-typed model without a required token (transliteration-safe)", () => {
  // The customer typed the model in Thai ("วีโก้") but the classifier returns the
  // Latin "Vigo"; with no numeric anchor the model must be KEPT so the search still
  // runs on the car — never re-ask for a car the customer already named.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "คอยเย็นวีโก้", carBrand: null, carModel: "Vigo", year: null }),
    latestText: "คอยเย็นวีโก้",
    history: [],
  });
  assert.equal(intent?.carModel, "Vigo");
});

test("grounds the model when a required-token anchor is present", () => {
  // With a model-code/year anchor in the text ("134"), the model IS grounded — a
  // model the customer never typed (classifier said Yaris) is dropped.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "วาล์วแอร์ 134", carBrand: null, carModel: "Yaris", year: null }),
    latestText: "วาล์ว 134",
    history: [],
  });
  assert.equal(intent?.carModel, null);
});

test("model synonym lookup grounds a Thai model glued to a cc anchor (Strada case)", () => {
  // Regression: "สายแอร์ใหญ่สตาด้า2500" — the cc "2500" is a required-token anchor,
  // so the model is grounded. The classifier returns the English "Strada" which does
  // NOT literally appear in the Thai text; without a synonym lookup it was dropped
  // → the vehicle scope vanished and the search drifted to other 2500cc models.
  // With the SearchSynonym-backed lookup ("สตาด้า"→"Strada"), the model survives.
  const modelLookup = new Map<string, string[]>([
    ["strada", ["strada", "สตาด้า", "สตราด้า", "mitsubishi strada"]],
    ["สตาด้า", ["strada", "สตาด้า", "สตราด้า", "mitsubishi strada"]],
  ]);
  // Segmented form (as `processText` reaches the guard) so the cc "2500" is a clean
  // required-token anchor — this is what makes the model subject to grounding.
  const latestText = "สายแอร์ใหญ่ สตาด้า 2500";
  const withLookup = guardChatSearchIntent({
    intent: baseIntent({ query: "สายแอร์ สตาด้า 2500", carBrand: null, carModel: "Strada", year: null }),
    latestText,
    history: [],
    modelLookup,
  });
  assert.deepEqual(withLookup.requiredTokens, ["2500"]);
  assert.equal(withLookup.intent?.carModel, "Strada");

  // Without the lookup, the old behaviour drops it (proves the lookup is the fix).
  const withoutLookup = guardChatSearchIntent({
    intent: baseIntent({ query: "สายแอร์ สตาด้า 2500", carBrand: null, carModel: "Strada", year: null }),
    latestText,
    history: [],
  });
  assert.equal(withoutLookup.intent?.carModel, null);
});

const groundingLookup = buildCarModelGroundingLookup([
  { term: "Vios", synonyms: ["วีออส", "Toyota Vios"] },
  { term: "Tiida", synonyms: ["ทีด้า", "ทีดา"] },
  { term: "March", synonyms: ["มาร์ช", "นิสสันมาร์ช"] },
  { term: "Jazz", synonyms: ["แจ๊ส", "Honda Jazz"] },
  { term: "Camry", synonyms: ["แคมรี่", "แคมรี"] },
  { term: "Hiace", synonyms: ["ไฮเอซ"] },
  { term: "Hiace Commuter", synonyms: ["ไฮเอซ", "Commuter"] },
  { term: "D-Max", synonyms: ["ดีแม็ก", "all new", "spark"] },
  { term: "AVEO", synonyms: ["อาวีโอ", "Chevrolet AVEO"] },
  { term: "AVEO CNG", synonyms: ["อาวีโอซีเอ็นจี", "AVOE CNG", "Chevrolet AVEO CNG"] },
  { term: "Spin", synonyms: ["สปิน", "spni", "Chevrolet Spin"] },
  { term: "Sonic", synonyms: ["โซนิค", "Chevrolet Sonic"] },
  { term: "DECA", synonyms: ["เดก้า", "deac", "Isuzu DECA"] },
]);

test("explicit evidence keeps the longest nested model (AVEO CNG, not AVEO)", () => {
  const evidence = resolveLatestExplicitCarModelEvidence({
    latestText: "Need radiator for Chevrolet AVEO CNG 2013",
    groundingLookup,
  });
  assert.equal(evidence?.canonicalModel, "AVEO CNG");

  const result = guardChatSearchIntent({
    intent: baseIntent({
      query: "radiator Chevrolet AVEO 2013",
      carBrand: "Chevrolet",
      carModel: "AVEO",
      year: 2013,
    }),
    latestText: "Need radiator for Chevrolet AVEO CNG 2013",
    history: [],
    modelGroundingLookup: groundingLookup,
  });
  assert.equal(result.intent?.carModel, "AVEO CNG");
});

test("explicit transposed AVEO CNG evidence also beats the broader AVEO classification", () => {
  const result = guardChatSearchIntent({
    intent: baseIntent({
      query: "radiator Chevrolet AVEO CNG",
      carBrand: "Chevrolet",
      carModel: "AVEO",
      year: null,
    }),
    latestText: "Need radiator for Chevrolet AVOE CNG",
    history: [],
    modelGroundingLookup: groundingLookup,
  });
  assert.equal(result.intent?.carModel, "AVEO CNG");
  assert.equal(result.forceLiteralQuery, true);
});

test("explicit safe typo aliases override a wrong classifier model", () => {
  for (const [latestText, wrongModel, expectedModel] of [
    ["Need evaporator for Chevrolet Spni 2013", "Sonic", "Spin"],
    ["หาคอยล์เย็น Isuzu DEAC 2014", "D-Max", "DECA"],
  ] as const) {
    const result = guardChatSearchIntent({
      intent: baseIntent({
        query: latestText,
        carBrand: latestText.includes("Isuzu") ? "Isuzu" : "Chevrolet",
        carModel: wrongModel,
        year: latestText.includes("2014") ? 2014 : 2013,
      }),
      latestText,
      history: [],
      modelGroundingLookup: groundingLookup,
    });
    assert.equal(result.intent?.carModel, expectedModel, latestText);
    assert.equal(result.forceLiteralQuery, true, `${latestText} must not reuse the wrong-model query`);
  }
});

test("explicit evidence does not choose between two unrelated vehicles", () => {
  assert.equal(
    resolveLatestExplicitCarModelEvidence({
      latestText: "เทียบคอยเย็น Vios กับ Jazz",
      groundingLookup,
    }),
    null,
  );
});

test("Latin model evidence is word-bounded (City must not match velocity)", () => {
  assert.equal(
    resolveLatestExplicitCarModelEvidence({
      latestText: "need high velocity condenser fan for Vios",
      groundingLookup,
    })?.canonicalModel,
    "Vios",
  );
});

test("shadow candidate drops a hallucinated no-anchor model without changing live intent", () => {
  const result = guardChatSearchIntent({
    intent: baseIntent({ query: "คอยเย็น", carBrand: null, carModel: "Vios", year: null }),
    latestText: "คอยเย็น",
    history: [],
    modelGroundingLookup: groundingLookup,
  });

  assert.equal(result.intent?.carModel, "Vios", "live Option-B behavior must remain unchanged");
  assert.equal(result.modelGroundingShadow?.candidateModel, null);
  assert.equal(result.modelGroundingShadow?.wouldChange, true);
  assert.equal(result.modelGroundingShadow?.evidenceSource, "NO_EVIDENCE");
});

test("shadow candidate keeps a real Thai synonym on a no-anchor turn", () => {
  const result = guardChatSearchIntent({
    intent: baseIntent({ query: "คอยเย็นวีออส", carBrand: null, carModel: "Vios", year: null }),
    latestText: "คอยเย็นวีออส",
    history: [],
    modelGroundingLookup: groundingLookup,
  });

  assert.equal(result.intent?.carModel, "Vios");
  assert.equal(result.modelGroundingShadow?.candidateModel, "Vios");
  assert.equal(result.modelGroundingShadow?.wouldChange, false);
  assert.equal(result.modelGroundingShadow?.evidenceSource, "SAFE_SYNONYM");
});

test("shadow candidate recovers a one-edit model spelling only from a verified latest mention", () => {
  for (const [model, mention, text] of [
    ["Tiida", "tida", "คอยเย็น tida"],
    ["March", "มาร์ค", "คอยเย็นนิสสันมาร์ค"],
    ["Camry", "คัมรี่", "คอมแอร์คัมรี่"],
  ] as const) {
    const result = evaluateChatModelGroundingCandidate({
      model,
      carMentionInLatest: mention,
      latestText: text,
      history: [],
      groundingLookup,
    });
    assert.equal(result?.candidateModel, model, `${mention} → ${model}`);
    assert.equal(result?.evidenceSource, "LATEST_MENTION_TYPO", mention);
  }

  const unverified = evaluateChatModelGroundingCandidate({
    model: "Tiida",
    carMentionInLatest: "tida",
    latestText: "คอยเย็น",
    history: [],
    groundingLookup,
  });
  assert.equal(unverified?.candidateModel, null);
});

test("shadow candidate normalizes a unique brand-prefixed classifier model", () => {
  const result = evaluateChatModelGroundingCandidate({
    model: "Nissan March",
    carMentionInLatest: "นิสสันมาร์ค",
    latestText: "คอยเย็นนิสสันมาร์ค",
    history: [],
    groundingLookup,
  });

  assert.equal(result?.candidateModel, "March");
  assert.equal(result?.evidenceSource, "LATEST_MENTION_TYPO");
});

test("shadow candidate rejects ambiguous and broad recall-only spellings", () => {
  const ambiguous = evaluateChatModelGroundingCandidate({
    model: "Hiace Commuter",
    carMentionInLatest: "ไฮเอซ",
    latestText: "คอยเย็นไฮเอซ",
    history: [],
    groundingLookup,
  });
  assert.equal(ambiguous?.candidateModel, null);
  assert.ok((ambiguous?.ambiguousVariantCount ?? 0) > 0);

  for (const text of ["คอยเย็น all new", "คอยเย็น spark"]) {
    const broad = evaluateChatModelGroundingCandidate({
      model: "D-Max",
      carMentionInLatest: text.split(" ").slice(1).join(" "),
      latestText: text,
      history: [],
      groundingLookup,
    });
    assert.equal(broad?.candidateModel, null, text);
  }
});

test("shadow lookup outage is observable and never proposes a behavior change", () => {
  const result = guardChatSearchIntent({
    intent: baseIntent({ query: "คอยเย็น", carBrand: null, carModel: "Vios", year: null }),
    latestText: "คอยเย็น",
    history: [],
    modelGroundingLookup: new Map(),
  });
  assert.equal(result.modelGroundingShadow?.evaluated, false);
  assert.equal(result.modelGroundingShadow?.evidenceSource, "LOOKUP_UNAVAILABLE");
  assert.equal(result.modelGroundingShadow?.wouldChange, false);
});
