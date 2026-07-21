import test from "node:test";
import assert from "node:assert/strict";

import type { CategoryAliasResolverRow } from "@/lib/category-alias-resolver";
import type { ChatSearchIntent, ChatSubject } from "@/lib/chat-core/ai-service";
import { detectChatMultiSubjectsFromRows } from "@/lib/chat-core/multi-subject-detector";

function row(
  alias: string,
  categoryId: string,
  categoryName: string,
  matchMode: CategoryAliasResolverRow["matchMode"] = "CONTAINS",
): CategoryAliasResolverRow {
  return {
    alias,
    kind: "MATCH",
    matchMode,
    priority: 100,
    isActive: true,
    category: { id: categoryId, name: categoryName, isActive: true },
  };
}

function intent(overrides: Partial<ChatSearchIntent> = {}): ChatSearchIntent {
  return {
    group: "product",
    query: "",
    isProductQuery: true,
    partType: null,
    carBrand: null,
    carModel: null,
    year: null,
    partKind: "fitment",
    tooBroad: false,
    ...overrides,
  };
}

const baseRows = [
  row("วาล์ว", "expansion", "Expansion Valve", "TOKEN"),
  row("ไดรเออร์", "drier", "Drier"),
  row("คอมแอร์", "compressor", "Compressor"),
  row("น้ำมันคอมแอร์", "oil", "Compressor Oil"),
  row("หน้าคลัชคอมแอร์", "clutch", "Compressor Clutch"),
  row("คอยล์เย็น", "evaporator", "Evaporator"),
  row("วาล์วคอยล์เย็น", "coil-valve", "Evaporator Valve"),
  row("ตู้แอร์", "air-box", "Air Box"),
  row("พัดลมตู้แอร์", "blower", "Blower"),
];

test("two non-overlapping mapped categories synthesize multi-subject without relying on connectors", () => {
  const result = detectChatMultiSubjectsFromRows({
    text: "วาล์ว/ไดรเออร์ triton ปี 2013",
    intent: intent({ carModel: "Triton", year: 2013 }),
    rows: baseRows,
  });

  assert.equal(result.source, "category_mapping");
  assert.deepEqual(result.categories, ["Expansion Valve", "Drier"]);
  assert.equal(result.subjects?.length, 2);
  assert.deepEqual(
    result.subjects?.map((subject) => [subject.partType, subject.carModel, subject.year]),
    [
      ["วาล์ว", "Triton", 2013],
      ["ไดรเออร์", "Triton", 2013],
    ],
  );
});

test("the same shared vehicle repeated between aliases remains a safe multi-subject turn", () => {
  const result = detectChatMultiSubjectsFromRows({
    text: "วาล์ว triton กับ ไดรเออร์ triton",
    intent: intent({ carModel: "Triton" }),
    rows: baseRows,
  });

  assert.equal(result.handoffReason, null);
  assert.equal(result.subjects?.length, 2);
});

test("different vehicle binding between aliases is handed off when the LLM did not structure subjects", () => {
  const result = detectChatMultiSubjectsFromRows({
    text: "วาล์ว Triton กับ ไดรเออร์ D-Max",
    intent: intent({ carModel: "Triton" }),
    rows: baseRows,
  });

  assert.equal(result.subjects, null);
  assert.equal(result.handoffReason, "AMBIGUOUS_VEHICLE_BINDING");
});

test("explicit LLM subjects preserve separate vehicle binding", () => {
  const subjects: ChatSubject[] = [
    { partType: "วาล์ว", carBrand: null, carModel: "Triton", year: null, partKind: "fitment", query: "วาล์ว Triton" },
    { partType: "ไดรเออร์", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment", query: "ไดรเออร์ D-Max" },
  ];
  const result = detectChatMultiSubjectsFromRows({
    text: "วาล์ว Triton กับ ไดรเออร์ D-Max",
    intent: intent({ subjects }),
    rows: baseRows,
  });

  assert.equal(result.source, "llm");
  assert.deepEqual(result.subjects, subjects);
  assert.equal(result.handoffReason, null);
});

for (const [compound, expectedCategory] of [
  ["น้ำมันคอมแอร์", "Compressor Oil"],
  ["หน้าคลัชคอมแอร์", "Compressor Clutch"],
  ["วาล์วคอยล์เย็น", "Evaporator Valve"],
  ["พัดลมตู้แอร์", "Blower"],
] as const) {
  test(`nested alias ${compound} is one category, not multi-subject`, () => {
    const result = detectChatMultiSubjectsFromRows({ text: compound, intent: intent(), rows: baseRows });
    assert.equal(result.subjects, null);
    assert.deepEqual(result.categories, [expectedCategory]);
  });
}

test("multiple aliases of the same canonical category are not multi-subject", () => {
  const rows = [row("ไดเออร์", "drier", "Drier"), row("ไดรเออร์", "drier", "Drier")];
  const result = detectChatMultiSubjectsFromRows({
    text: "ไดเออร์ หรือ ไดรเออร์",
    intent: intent(),
    rows,
  });
  assert.equal(result.subjects, null);
  assert.deepEqual(result.categories, ["Drier"]);
});

test("replacement and negation cues never synthesize old and new aliases as multi-subject", () => {
  for (const text of ["ไม่เอาวาล์วแล้ว เอาไดรเออร์", "เปลี่ยนจากวาล์วเป็นไดรเออร์"]) {
    const result = detectChatMultiSubjectsFromRows({ text, intent: intent(), rows: baseRows });
    assert.equal(result.subjects, null, text);
  }
});

test("an active skip alias blocks mapping-based multi-subject synthesis", () => {
  const rows: CategoryAliasResolverRow[] = [
    ...baseRows,
    {
      alias: "สอบถามทั่วไป",
      kind: "SKIP_CATEGORY",
      matchMode: "CONTAINS",
      priority: 999,
      isActive: true,
      category: null,
    },
  ];
  const result = detectChatMultiSubjectsFromRows({
    text: "สอบถามทั่วไป วาล์ว/ไดรเออร์",
    intent: intent(),
    rows,
  });
  assert.equal(result.subjects, null);
  assert.deepEqual(result.categories, []);
});

test("TOKEN aliases require a token boundary and do not match inside another word", () => {
  const result = detectChatMultiSubjectsFromRows({
    text: "วาล์วคอยล์เย็น กับ ไดรเออร์",
    intent: intent(),
    rows: baseRows,
  });
  assert.deepEqual(result.categories, ["Evaporator Valve", "Drier"]);
  assert.equal(result.subjects?.length, 2);
});
