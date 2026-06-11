import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent } from "@/lib/generated/prisma";
import { searchLineProductInquiry } from "@/lib/line-product-search-bridge";
import type { LineIntentRouteResult } from "@/lib/line-intent-router";

const searchableRoute: LineIntentRouteResult = {
  intent: LineIntent.PRODUCT_INQUIRY_TEXT,
  allowsSearch: true,
  requiresAdmin: false,
  requiresImageAnalysis: false,
  requiresMoreInfo: false,
  reason: "PRODUCT_HINT",
};

test("searchable product inquiry calls existing search contract", async () => {
  const calls: unknown[] = [];

  const result = await searchLineProductInquiry(
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
      categoryName: null,
      carBrandName: null,
      carModelName: null,
      fitmentYear: null,
      skip: 0,
      take: 3,
      cacheProfile: "admin",
    },
  ]);
});

test("non-searchable intents do not call search", async () => {
  const result = await searchLineProductInquiry(
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
  const result = await searchLineProductInquiry(
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
  const result = await searchLineProductInquiry(
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
  const result = await searchLineProductInquiry(
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

test("part image inquiry searches using extracted vision hints when allowed", async () => {
  const calls: unknown[] = [];

  const result = await searchLineProductInquiry(
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
  const result = await searchLineProductInquiry(
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
  const result = await searchLineProductInquiry(
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

test("numeric model or part tokens are sent as required tokens for LINE search", async () => {
  const calls: unknown[] = [];

  const result = await searchLineProductInquiry(
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
      categoryName: null,
      carBrandName: null,
      carModelName: null,
      fitmentYear: null,
      requiredTokens: ["709"],
      skip: 0,
      take: 5,
      cacheProfile: "admin",
    },
  ]);
});
