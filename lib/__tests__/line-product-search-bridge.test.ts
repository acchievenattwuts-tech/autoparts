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
    async (input) => ({ ids: ["p2"], total: 1, mode: "v2", matchReasons: { p2: ["code"] } }),
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
