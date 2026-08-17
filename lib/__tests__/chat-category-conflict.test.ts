import test from "node:test";
import assert from "node:assert/strict";

import { chatCategoryDisagreesWithPartType } from "@/lib/chat-core/category-conflict";

const CONDENSER = "คอยล์ร้อน (Condenser)";
const FAN_BLADE = "ใบพัดลม (Cooling Fan Blade)";
const BLOWER = "โบเวอร์ พัดลมแอร์ (Blower Motor)";

test("fires when the resolved category cannot be justified by the part word", () => {
  // The 2026-08-17 incident: alias "คอยร้อน" matched inside "แผงคอยร้อน" and
  // hard-filtered a fan question into condensers.
  assert.equal(
    chatCategoryDisagreesWithPartType({ partType: "พัดลม", resolvedCategoryName: CONDENSER }),
    true,
  );
  // Same shape found in the production sweep: a radiator turn scoped to compressors.
  assert.equal(
    chatCategoryDisagreesWithPartType({
      partType: "หม้อน้ำ",
      resolvedCategoryName: "คอมแอร์ (Compressor)",
    }),
    true,
  );
});

test("stays silent when the category NAME accounts for the part word", () => {
  assert.equal(
    chatCategoryDisagreesWithPartType({ partType: "พัดลม", resolvedCategoryName: FAN_BLADE }),
    false,
  );
  assert.equal(
    chatCategoryDisagreesWithPartType({ partType: "โบเวอร์", resolvedCategoryName: BLOWER }),
    false,
  );
  // One spelling edit is tolerated — the catalog writes "โบเวอร์", customers
  // routinely type "โบลเวอร์".
  assert.equal(
    chatCategoryDisagreesWithPartType({ partType: "โบลเวอร์", resolvedCategoryName: BLOWER }),
    false,
  );
});

test("stays silent when the alias table or dictionary justifies the category", () => {
  // "แผงแอร์" is not in the category name, but it maps to that category.
  assert.equal(
    chatCategoryDisagreesWithPartType({
      partType: "แผงแอร์",
      resolvedCategoryName: CONDENSER,
      partTypeCategoryName: CONDENSER,
    }),
    false,
  );
  // The colloquial dictionary returns a distinctive FRAGMENT of the name.
  assert.equal(
    chatCategoryDisagreesWithPartType({
      partType: "คอมแอร์",
      resolvedCategoryName: "คอมเพรสเซอร์แอร์ (Compressor)",
      partTypeCategoryHint: "(Compressor)",
    }),
    false,
  );
  // A DIFFERENT category from the alias table is not a justification.
  assert.equal(
    chatCategoryDisagreesWithPartType({
      partType: "แผงแอร์",
      resolvedCategoryName: "คอยล์เย็น (Evaporator)",
      partTypeCategoryName: CONDENSER,
    }),
    true,
  );
});

test("a broad catch-all part word is never read as a disagreement", () => {
  // It cannot justify ANY category, so firing on it would say nothing about
  // whether the category is wrong. The search gate owns these turns instead.
  for (const partType of ["อะไหล่แอร์", "อะไหล่รถ"]) {
    assert.equal(
      chatCategoryDisagreesWithPartType({
        partType,
        resolvedCategoryName: "คอมแอร์ (Compressor)",
      }),
      false,
      partType,
    );
  }
});

test("never fires without both a part word and a category", () => {
  assert.equal(
    chatCategoryDisagreesWithPartType({ partType: null, resolvedCategoryName: CONDENSER }),
    false,
  );
  assert.equal(
    chatCategoryDisagreesWithPartType({ partType: "พัดลม", resolvedCategoryName: null }),
    false,
  );
  assert.equal(
    chatCategoryDisagreesWithPartType({ partType: "   ", resolvedCategoryName: CONDENSER }),
    false,
  );
});
