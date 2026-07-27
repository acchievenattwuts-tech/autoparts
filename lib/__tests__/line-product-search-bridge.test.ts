import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent } from "@/lib/generated/prisma";
import { searchChatProductInquiry } from "@/lib/chat-core/product-search-bridge";
import type { ChatIntentRouteResult } from "@/lib/chat-core/intent-router";

const searchableRoute: ChatIntentRouteResult = {
  intent: LineIntent.PRODUCT_INQUIRY_TEXT,
  allowsSearch: true,
  requiresAdmin: false,
  requiresImageAnalysis: false,
  requiresMoreInfo: false,
  reason: "PRODUCT_HINT",
};

test("searchable product inquiry calls existing search contract", async () => {
  const calls: unknown[] = [];

  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์ vios 2012",
      take: 3,
    },
    async (input) => {
      calls.push(input);
      return { ids: ["p1"], total: 1, mode: "v2", matchReasons: { p1: ["name"] } };
    },
  );

  assert.equal(result.searched, true);
  assert.equal(result.query, "คอมแอร์ vios 2012");
  assert.deepEqual(calls, [
    {
      query: "คอมแอร์ vios 2012",
      isActive: true,
      isStorefrontVisible: true,
      categoryName: null,
      carBrandName: null,
      carModelName: null,
      fitmentYear: null,
      skip: 0,
      take: 3,
      cacheProfile: "storefront",
    },
  ]);
});

test("broad OR-fallback flag is propagated to the caller (audit item D)", async () => {
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์ vios 2012",
      take: 3,
    },
    async () => ({
      ids: ["p1"],
      total: 1,
      mode: "v2",
      matchReasons: { p1: ["fitment"] },
      usedBroadFallback: true,
    }),
  );

  assert.equal(result.searched, true);
  // The caller relies on result.usedBroadFallback to add the "near-match" note.
  assert.equal(result.searched && result.result.usedBroadFallback, true);
});

test("a precise (non-fallback) search does not flag a broad fallback", async () => {
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์ vios 2012",
      take: 3,
    },
    async () => ({ ids: ["p1"], total: 1, mode: "v2", matchReasons: { p1: ["name"] } }),
  );

  assert.equal(result.searched, true);
  assert.equal(result.searched && result.result.usedBroadFallback === true, false);
});

test("high-trigram product ids are propagated to the caller (relevance gate)", async () => {
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์ vios 2012",
      take: 3,
    },
    async () => ({
      ids: ["p1", "p2"],
      total: 2,
      mode: "v2",
      matchReasons: { p1: ["keyword"], p2: [] },
      highTrigramProductIds: ["p2"],
    }),
  );

  assert.equal(result.searched, true);
  assert.deepEqual(result.searched ? result.result.highTrigramProductIds : null, ["p2"]);
});

test("non-searchable intents do not call search", async () => {
  const result = await searchChatProductInquiry(
    {
      route: {
        intent: LineIntent.SHIPPING_ADDRESS,
        allowsSearch: false,
        requiresAdmin: true,
        requiresImageAnalysis: false,
        requiresMoreInfo: false,
        reason: "SHIPPING_ADDRESS_KEYWORD",
      },
      text: "ที่อยู่จัดส่ง",
    },
    async () => {
      throw new Error("search should not be called");
    },
  );

  assert.deepEqual(result, {
    searched: false,
    reason: "NON_SEARCHABLE_INTENT_SHIPPING_ADDRESS",
    query: null,
    result: null,
  });
});

test("weak search results require more information", async () => {
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์รุ่นไม่ชัด",
    },
    async () => ({ ids: [], total: 0, mode: "v2", matchReasons: {} }),
    async () => [],
  );

  assert.equal(result.searched, true);
  assert.equal(result.needsMoreInfo, true);
});

test("combines message text with carried-over context terms into one query", async () => {
  let captured = "";
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์",
      contextHints: ["วีออส", "2017"],
    },
    async (input) => {
      captured = input.query ?? "";
      return { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} };
    },
  );

  assert.equal(result.searched, true);
  assert.equal(captured, "คอมแอร์ วีออส 2017");
});

test("retries with a did-you-mean suggestion when the first search is empty", async () => {
  const queries: string[] = [];
  const result = await searchChatProductInquiry(
    { route: searchableRoute, text: "คอมแarr" },
    async (input) => {
      queries.push(input.query ?? "");
      return input.query === "คอมแอร์"
        ? { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} }
        : { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    async () => ["คอมแอร์"],
  );

  assert.equal(result.searched, true);
  assert.equal(result.needsMoreInfo, false);
  assert.equal(result.query, "คอมแอร์");
  assert.deepEqual(queries, ["คอมแarr", "คอมแอร์"]);
});

test("did-you-mean retry keeps category/brand/model, drops only the year", async () => {
  const calls: Array<{ query: string; categoryName: unknown; fitmentYear: unknown }> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอยร้อนวีออส03",
      fitmentHints: {
        categoryName: "คอยล์ร้อน (Condenser)",
        carBrandName: "Toyota",
        carModelName: "Vios",
        fitmentYear: 2003,
      },
    },
    async (input) => {
      calls.push({
        query: input.query ?? "",
        categoryName: input.categoryName,
        fitmentYear: input.fitmentYear,
      });
      // First search (year 2003 hard filter) is empty; suggestion-based retry hits.
      return input.fitmentYear === null
        ? { ids: ["p66"], total: 1, mode: "v2", matchReasons: {} }
        : { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    async () => ["แผงแอร์ Toyota Vios 2013"],
  );

  assert.equal(result.searched, true);
  assert.equal(result.query, "แผงแอร์ Toyota Vios 2013");
  // Initial search carried the year; retry kept category but dropped the year.
  assert.equal(calls[0].fitmentYear, 2003);
  assert.equal(calls[1].fitmentYear, null);
  assert.equal(calls[1].categoryName, "คอยล์ร้อน (Condenser)");
  // The link must mirror the filters actually applied (no contradictory year).
  if (result.searched) {
    assert.deepEqual(result.appliedFilters, {
      categoryName: "คอยล์ร้อน (Condenser)",
      carBrandName: "Toyota",
      carModelName: "Vios",
      fitmentYear: null,
    });
  }
});

test("unresolved OCR code from an image is dropped from the query, not forced as a filter", async () => {
  const searchInputs: Array<{ query: string }> = [];
  const result = await searchChatProductInquiry(
    {
      route: {
        intent: LineIntent.PART_IMAGE_INQUIRY,
        allowsSearch: true,
        requiresAdmin: false,
        requiresImageAnalysis: false,
        requiresMoreInfo: false,
        reason: "IMAGE_CLASSIFIED_PART:search=on",
      },
      text: "แผงแอร์ Toyota Vios",
      extractedImageHints: ["แผงแอร์", "Vios", "2903E"],
    },
    async (input) => {
      searchInputs.push({ query: input.query ?? "" });
      return { ids: ["p66"], total: 1, mode: "v2", matchReasons: {} };
    },
    undefined,
    // OCR code "2903E" resolves to nothing in the catalog.
    async () => [],
  );

  assert.equal(result.searched, true);
  // The garbage code must NOT appear in the executed query.
  assert.ok(!searchInputs[0].query.includes("2903E"));
  assert.equal(searchInputs[0].query, "แผงแอร์ Toyota Vios");
  if (result.searched) assert.deepEqual(result.droppedImageCodes, ["2903E"]);
});

test("a resolvable OCR code from an image is kept in the query", async () => {
  const searchInputs: Array<{ query: string }> = [];
  const result = await searchChatProductInquiry(
    {
      route: {
        intent: LineIntent.PART_IMAGE_INQUIRY,
        allowsSearch: true,
        requiresAdmin: false,
        requiresImageAnalysis: false,
        requiresMoreInfo: false,
        reason: "IMAGE_CLASSIFIED_PART:search=on",
      },
      text: "แผงแอร์ Vios",
      extractedImageHints: ["แผงแอร์", "Vios", "STB-2116S"],
    },
    async (input) => {
      searchInputs.push({ query: input.query ?? "" });
      return { ids: ["p66"], total: 1, mode: "v2", matchReasons: {} };
    },
    undefined,
    async (codes) => codes, // every code resolves
  );

  assert.equal(result.searched, true);
  assert.ok(searchInputs[0].query.includes("STB-2116S"));
  if (result.searched) assert.deepEqual(result.droppedImageCodes, []);
});

test("part image inquiry searches using extracted vision hints when allowed", async () => {
  const calls: unknown[] = [];

  const result = await searchChatProductInquiry(
    {
      route: {
        intent: LineIntent.PART_IMAGE_INQUIRY,
        allowsSearch: true,
        requiresAdmin: false,
        requiresImageAnalysis: false,
        requiresMoreInfo: false,
        reason: "IMAGE_CLASSIFIED_PART:search=on",
      },
      text: null,
      extractedImageHints: ["คอมแอร์", "vios"],
    },
    async (input) => {
      calls.push(input);
      return { ids: ["p9"], total: 1, mode: "v2", matchReasons: { p9: ["alias"] } };
    },
  );

  assert.equal(result.searched, true);
  assert.equal(result.query, "คอมแอร์ vios");
  assert.equal(calls.length, 1);
});

test("part image inquiry does not search when allowsSearch is off", async () => {
  const result = await searchChatProductInquiry(
    {
      route: {
        intent: LineIntent.PART_IMAGE_INQUIRY,
        allowsSearch: false,
        requiresAdmin: false,
        requiresImageAnalysis: false,
        requiresMoreInfo: false,
        reason: "IMAGE_CLASSIFIED_PART:search=off",
      },
      extractedImageHints: ["คอมแอร์"],
    },
    async () => {
      throw new Error("search should not be called");
    },
  );

  assert.equal(result.searched, false);
});

test("part number seed takes precedence over free text", async () => {
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "ขอราคาคอมแอร์",
      extractedPartNumber: "447220-1234",
    },
    async () => ({ ids: ["p2"], total: 1, mode: "v2", matchReasons: { p2: ["code"] } }),
  );

  assert.equal(result.searched, true);
  assert.equal(result.query, "447220-1234");
});

test("accessory head noun is required when there is no category filter", async () => {
  const calls: Array<string[] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "มีฟองน้ำแบบเส้นไหมครับ",
      accessoryHeadNoun: "ฟองน้ำ",
    },
    async (input) => {
      calls.push(input.requiredTokens ?? null);
      return { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} };
    },
  );

  assert.equal(result.searched, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["ฟองน้ำ"]);
  if (result.searched) assert.equal(result.reason, "SEARCHED_ACCESSORY_HEAD_ANCHORED");
});

test("accessory head noun falls back to a broad search when the strict one is empty", async () => {
  const calls: Array<string[] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "โฟมเส้น",
      accessoryHeadNoun: "โฟมเส้น",
    },
    async (input) => {
      const req = input.requiredTokens ?? null;
      calls.push(req);
      // Strict search (head noun required) finds nothing; broad search hits.
      return req && req.includes("โฟมเส้น")
        ? { ids: [], total: 0, mode: "v2", matchReasons: {} }
        : { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} };
    },
  );

  assert.equal(result.searched, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["โฟมเส้น"]); // strict attempt
  assert.equal(calls[1], null); // broad fallback drops the head noun
  if (result.searched) assert.equal(result.reason, "SEARCHED_ACCESSORY_HEAD_FALLBACK");
});

test("accessory head noun is ignored when a category filter is present (fitment untouched)", async () => {
  const calls: Array<string[] | null> = [];
  await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "หม้อน้ำ vios",
      accessoryHeadNoun: "หม้อน้ำ",
      fitmentHints: { categoryName: "หม้อน้ำ (Radiator)" },
    },
    async (input) => {
      calls.push(input.requiredTokens ?? null);
      return { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} };
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0], null); // head noun NOT anchored because a category applies
});

test("fitment part head noun anchors the search when no category resolves", async () => {
  const calls: Array<string[] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "เช็ค เทอร์โมสตรัท Vios 2017",
      fitmentPartHeadNoun: "เทอร์โมสตรัท",
      fitmentHints: { carModelName: "Vios", fitmentYear: 2017 },
    },
    async (input) => {
      calls.push(input.requiredTokens ?? null);
      return { ids: ["p1"], total: 4, mode: "v2", matchReasons: {} };
    },
  );

  assert.equal(result.searched, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["เทอร์โมสตรัท"]);
  if (result.searched) assert.equal(result.reason, "SEARCHED_FITMENT_PART_ANCHORED");
});

test("did-you-mean recovery flags the correction + dropped year (transparency)", async () => {
  let call = 0;
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอยเย้น avanza",
      fitmentHints: { carModelName: "Avanza", fitmentYear: 2013 },
    },
    async () => {
      call += 1;
      // First (original) search finds nothing; the did-you-mean retry hits.
      return call === 1
        ? { ids: [], total: 0, mode: "v2", matchReasons: {} }
        : { ids: ["p1"], total: 2, mode: "v2", matchReasons: {} };
    },
    async () => ["คอยเย็น avanza"],
  );

  assert.equal(result.searched, true);
  if (result.searched) {
    assert.deepEqual(result.didYouMean, { suggestion: "คอยเย็น avanza", droppedYear: true });
  }
});

test("a normal (non-recovered) search reports no did-you-mean", async () => {
  const result = await searchChatProductInquiry(
    { route: searchableRoute, text: "คอมแอร์ vios" },
    async () => ({ ids: ["p1"], total: 1, mode: "v2", matchReasons: {} }),
  );
  assert.equal(result.searched, true);
  if (result.searched) assert.equal(result.didYouMean, null);
});

test("fitment part head noun does NOT broaden on empty — returns no-match (no model-only drift)", async () => {
  const calls: Array<string[] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "เช็ค เทอร์โมสตรัท Vios 2017",
      fitmentPartHeadNoun: "เทอร์โมสตรัท",
      fitmentHints: { carModelName: "Vios", fitmentYear: 2017 },
    },
    async (input) => {
      calls.push(input.requiredTokens ?? null);
      // The specific part isn't in the catalog → strict anchored search is empty.
      return { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    // suggestFn: no spelling suggestions so the did-you-mean loop is skipped.
    async () => [],
  );

  assert.equal(result.searched, true);
  // Only ONE search — never re-runs broad/model-only (unlike the accessory anchor).
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["เทอร์โมสตรัท"]);
  if (result.searched) {
    assert.equal(result.needsMoreInfo, true);
    assert.equal(result.reason, "SEARCHED_FITMENT_PART_NO_MATCH");
    assert.equal(result.result.total, 0);
  }
});

test("fitment part head noun is ignored when a category filter is present", async () => {
  const calls: Array<string[] | null> = [];
  await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์ vios",
      fitmentPartHeadNoun: "คอมแอร์",
      fitmentHints: { categoryName: "คอมแอร์ (Compressor)" },
    },
    async (input) => {
      calls.push(input.requiredTokens ?? null);
      return { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} };
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0], null); // not anchored because a category already scopes it
});

test("fitment part anchor is kept through the did-you-mean spelling retry", async () => {
  const calls: Array<string[] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "เทอร์โมสตรัท vios",
      fitmentPartHeadNoun: "เทอร์โมสตรัท",
    },
    async (input) => {
      calls.push(input.requiredTokens ?? null);
      return { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    async () => ["เทอร์โมสตัท vios"],
  );

  assert.equal(result.searched, true);
  // primary + one did-you-mean retry, both keep the fitment anchor.
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["เทอร์โมสตรัท"]);
  assert.deepEqual(calls[1], ["เทอร์โมสตรัท"]);
});

test("numeric model or part tokens are sent as required tokens for LINE search", async () => {
  const calls: unknown[] = [];

  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอม dragon 709",
    },
    async (input) => {
      calls.push(input);
      return { ids: ["p-dragon"], total: 1, mode: "v2", matchReasons: { "p-dragon": ["name"] } };
    },
  );

  assert.equal(result.searched, true);
  assert.deepEqual(calls, [
    {
      query: "คอม dragon 709",
      isActive: true,
      isStorefrontVisible: true,
      categoryName: null,
      carBrandName: null,
      carModelName: null,
      fitmentYear: null,
      requiredTokens: ["709"],
      skip: 0,
      take: 5,
      cacheProfile: "storefront",
    },
  ]);
});

test("did-you-mean retry is capped at the top 2 suggestions (C1)", async () => {
  const queries: string[] = [];
  const result = await searchChatProductInquiry(
    { route: searchableRoute, text: "คอมแarr" },
    async (input) => {
      queries.push(input.query ?? "");
      // Only the 3rd (lowest-similarity) suggestion would hit — the capped loop
      // must never reach it, so the turn ends as a normal no-match.
      return input.query === "ตัวเลือกที่สาม"
        ? { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} }
        : { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    async () => ["ตัวเลือกแรก", "ตัวเลือกที่สอง", "ตัวเลือกที่สาม"],
  );

  assert.equal(result.searched, true);
  assert.equal(result.needsMoreInfo, true);
  // Primary search + exactly 2 retries — the 3rd suggestion is never searched.
  assert.deepEqual(queries, ["คอมแarr", "ตัวเลือกแรก", "ตัวเลือกที่สอง"]);
  if (result.searched) assert.equal(result.didYouMean, null);
});

test("fan blade size/direction stay hard-required and empty result becomes direct spec no-match", async () => {
  const calls: Array<string[][] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "พัดลมเป่า 14นิ้วมีไหมคับ",
      fitmentHints: { categoryName: "ใบพัดลม (Cooling Fan Blade)" },
    },
    async (input) => {
      calls.push(input.requiredNameAliasTokenGroups ?? null);
      return { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    async () => [],
  );

  assert.equal(result.searched, true);
  assert.deepEqual(calls, [[
    ["14 นิ้ว", "14นิ้ว", "14 inch", "14inch", '14"'],
    ["แบบเป่า", "พัดลมเป่า", "push fan", "pusher fan"],
  ]]);
  if (result.searched) {
    assert.equal(result.reason, "SEARCHED_PRODUCT_SPEC_NO_MATCH");
    assert.equal(result.result.total, 0);
  }
});

test("physical identity constraints keep semantic recall inside matching name/alias evidence", async () => {
  const calls: Array<string[][] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "วาล์วแอร์ 1 หาง No 80 ธรรมดา หัว Taper",
      fitmentHints: { categoryName: "วาล์ว (Expansion Valve)" },
    },
    async (input) => {
      calls.push(input.requiredNameAliasTokenGroups ?? null);
      return {
        ids: ["p0444"],
        total: 1,
        mode: "v2",
        matchReasons: { p0444: ["keyword"] },
      };
    },
  );

  assert.deepEqual(calls, [[
    ["1 หาง", "1หาง", "1 tail", "1tail", "หางเดียว", "single tail", "one tail"],
    ["taper", "หัว taper", "หัวtaper", "เตเปอร์", "หัวเตเปอร์", "เทเปอร์", "หัวเทเปอร์"],
  ]]);
  assert.equal(result.searched, true);
  if (result.searched) {
    assert.deepEqual(result.result.ids, ["p0444"]);
    assert.deepEqual(result.result.appliedConstraintKeys, ["count:tail:1", "connector:taper"]);
  }
});

test("physical identity no-match stays narrow and requests a human instead of broad products", async () => {
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "วาล์วแอร์ 2 หาง หัว Taper",
      fitmentHints: { categoryName: "วาล์ว (Expansion Valve)" },
    },
    async () => ({ ids: [], total: 0, mode: "v2", matchReasons: {} }),
    async () => [],
  );

  assert.equal(result.searched, true);
  if (result.searched) {
    assert.equal(result.reason, "SEARCHED_PRODUCT_SPEC_NO_MATCH");
    assert.equal(result.needsMoreInfo, true);
  }
});

test("fan blade spec groups survive did-you-mean retry", async () => {
  const calls: Array<string[][] | null> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "พัดลมดูด 10 นิ้ว 24V",
      fitmentHints: { categoryName: "ใบพัดลม (Cooling Fan Blade)" },
    },
    async (input) => {
      calls.push(input.requiredNameAliasTokenGroups ?? null);
      return { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    async () => ["พัดลมดูด 10 นิ้ว"],
  );

  assert.equal(result.searched, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.deepEqual(calls[0]?.[0], ["10 นิ้ว", "10นิ้ว", "10 inch", "10inch", '10"']);
  assert.deepEqual(calls[0]?.[1], ["แบบดูด", "พัดลมดูด", "pull fan", "suction fan"]);
  assert.deepEqual(calls[0]?.[2], ["24v", "24 v", "24 โวลต์"]);
});

test("did-you-mean retry still recovers from the 2nd suggestion under the cap (C1)", async () => {
  const queries: string[] = [];
  const result = await searchChatProductInquiry(
    { route: searchableRoute, text: "คอมแarr" },
    async (input) => {
      queries.push(input.query ?? "");
      return input.query === "ตัวเลือกที่สอง"
        ? { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} }
        : { ids: [], total: 0, mode: "v2", matchReasons: {} };
    },
    async () => ["ตัวเลือกแรก", "ตัวเลือกที่สอง", "ตัวเลือกที่สาม"],
  );

  assert.equal(result.searched, true);
  assert.equal(result.needsMoreInfo, false);
  assert.equal(result.query, "ตัวเลือกที่สอง");
  assert.deepEqual(queries, ["คอมแarr", "ตัวเลือกแรก", "ตัวเลือกที่สอง"]);
});

test("accessory rescue: empty vehicle-scoped search retries without the vehicle", async () => {
  // The LINE inquiry frame carries the customer's car across a topic shift, so a
  // universal ask ("มีน้ำยาล้างคอยล์ไหม") right after "หม้อน้ำ vios 2010" arrives with
  // Vios/2010 hard filters. A universal SKU has no fitment rows, so that search is
  // always empty — the rescue re-runs it car-less, keeping the head-noun anchor.
  const inputs: Array<{ carModelName: unknown; fitmentYear: unknown; requiredTokens?: unknown }> = [];

  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "น้ำยาล้างคอยล์",
      fitmentHints: {
        categoryName: null,
        carBrandName: "Toyota",
        carModelName: "Vios",
        fitmentYear: 2010,
      },
      accessoryHeadNoun: "น้ำยาล้างคอยล์",
      take: 5,
    },
    async (input) => {
      inputs.push({
        carModelName: input.carModelName,
        fitmentYear: input.fitmentYear,
        requiredTokens: input.requiredTokens,
      });
      const vehicleScoped = Boolean(input.carModelName || input.fitmentYear);
      return vehicleScoped
        ? { ids: [], total: 0, mode: "v2" }
        : { ids: ["cleaner-1"], total: 1, mode: "v2", matchReasons: { "cleaner-1": ["name"] } };
    },
  );

  assert.equal(inputs.length, 2, "one vehicle-scoped attempt, then the car-less retry");
  assert.equal(inputs[0]?.carModelName, "Vios");
  assert.equal(inputs[1]?.carModelName, null, "retry drops the model");
  assert.equal(inputs[1]?.fitmentYear, null, "retry drops the year");
  assert.deepEqual(
    inputs[1]?.requiredTokens,
    ["น้ำยาล้างคอยล์"],
    "retry keeps the head-noun anchor so results stay on topic",
  );
  assert.equal(result.searched && result.result.total, 1);
  assert.equal(result.searched && result.reason, "SEARCHED_ACCESSORY_HEAD_ANCHORED_NO_VEHICLE");
  assert.equal(result.searched && result.accessoryVehicleDropped, true);
  assert.deepEqual(
    result.searched && result.appliedFilters,
    { categoryName: null, carBrandName: null, carModelName: null, fitmentYear: null },
    "the web link must mirror the car-less search the customer actually saw",
  );
});

test("accessory rescue never runs when the vehicle-scoped search already found rows", async () => {
  let calls = 0;

  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "สายน้ำยาแอร์",
      fitmentHints: {
        categoryName: null,
        carBrandName: "Honda",
        carModelName: "CRV",
        fitmentYear: 2014,
      },
      accessoryHeadNoun: "สายน้ำยาแอร์",
      take: 5,
    },
    async () => {
      calls += 1;
      return { ids: ["hose-1"], total: 1, mode: "v2", matchReasons: { "hose-1": ["name"] } };
    },
  );

  assert.equal(calls, 1, "a successful vehicle-scoped search is never re-run car-less");
  assert.equal(result.searched && result.accessoryVehicleDropped, false);
  assert.deepEqual(result.searched && result.appliedFilters, {
    categoryName: null,
    carBrandName: "Honda",
    carModelName: "CRV",
    fitmentYear: 2014,
  });
});

test("accessory rescue leaves a non-accessory (fitment) turn untouched", async () => {
  // A fitment part the classifier mislabels must NOT lose its vehicle scope — that
  // is why the rescue is gated on the accessory head-noun anchor.
  let calls = 0;

  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอยล์เย็น Vios",
      fitmentHints: {
        categoryName: "คอยล์เย็น (Evaporator)",
        carBrandName: "Toyota",
        carModelName: "Vios",
        fitmentYear: 2010,
      },
      take: 5,
    },
    async () => {
      calls += 1;
      return { ids: [], total: 0, mode: "v2" };
    },
  );

  assert.equal(calls, 1, "no car-less retry without the accessory anchor");
  assert.equal(result.searched && result.accessoryVehicleDropped, false);
  assert.equal(result.searched && result.result.total, 0);
});
