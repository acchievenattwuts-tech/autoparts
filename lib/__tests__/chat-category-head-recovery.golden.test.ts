import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent } from "@/lib/generated/prisma";
import type { ChatIntentRouteResult } from "@/lib/chat-core/intent-router";
import {
  searchChatProductInquiry,
  type ChatProductSearchBridgeInput,
} from "@/lib/chat-core/product-search-bridge";

/** The bridge's search-fn input (the type itself is not exported). */
type ProductSearchInput = Parameters<NonNullable<Parameters<typeof searchChatProductInquiry>[1]>>[0];

/**
 * Golden: LINE 2026-10-23 09:46 — "คอมแอร์ดีแมคปี08" (Thai typed without spaces).
 * The classifier read คอมแอร์ / Isuzu D-Max / 2008 correctly, but the glued text
 * matched nothing, and the did-you-mean retry ("คอมแอร์ดีแมค", year dropped) found
 * only P0425 — P0029 (STAL, same fitment) was silently missing. The fix retries
 * with the category's Thai name under the SAME filters before did-you-mean.
 */

const route: ChatIntentRouteResult = {
  intent: LineIntent.PRODUCT_INQUIRY_TEXT,
  allowsSearch: true,
  requiresAdmin: false,
  requiresImageAnalysis: false,
  requiresMoreInfo: false,
  reason: "DEFAULT_PRODUCT_INQUIRY",
};

const INCIDENT_FILTERS = {
  categoryName: "คอมแอร์ (Compressor)",
  carBrandName: "Isuzu",
  carModelName: "D-Max",
  fitmentYear: 2008,
};

const incidentInput = (overrides: Partial<ChatProductSearchBridgeInput> = {}): ChatProductSearchBridgeInput => ({
  route,
  text: "คอมแอร์ดีแมคปี 2008",
  customerText: "คอมแอร์ดีแมคปี08",
  contextHints: [],
  fitmentHints: INCIDENT_FILTERS,
  take: 5,
  ...overrides,
});

type SearchCall = ProductSearchInput;

/** Catalog stub: only the category-head query finds the two compressors. */
const catalogStub = (calls: SearchCall[], answers: Record<string, string[]>) =>
  async (input: ProductSearchInput) => {
    calls.push(input);
    const ids = answers[input.query ?? ""] ?? [];
    return { ids, total: ids.length, mode: "v2" as const, matchReasons: Object.fromEntries(ids.map((id) => [id, ["fitment"]])) };
  };

const filtersOf = (call: SearchCall) => ({
  categoryName: call.categoryName,
  carBrandName: call.carBrandName,
  carModelName: call.carModelName,
  fitmentYear: call.fitmentYear,
  requiredTokens: call.requiredTokens ?? [],
  requiredNameAliasTokenGroups: call.requiredNameAliasTokenGroups ?? [],
});

test("incident: glued Thai text recovers BOTH compressors via the category head, year kept", async () => {
  const calls: SearchCall[] = [];
  let suggested = false;
  const result = await searchChatProductInquiry(
    incidentInput(),
    catalogStub(calls, { "คอมแอร์": ["P0425", "P0029"] }),
    async () => {
      suggested = true;
      return ["คอมแอร์ดีแมค"];
    },
  );

  assert.equal(result.searched, true);
  if (!result.searched) return;
  assert.deepEqual(result.result.ids, ["P0425", "P0029"]);
  assert.equal(result.reason, "SEARCHED_CATEGORY_HEAD_RECOVERED");
  assert.equal(result.categoryHeadRecovered, true);
  assert.equal(result.query, "คอมแอร์");
  assert.equal(result.didYouMean, null);
  assert.equal(result.yearMismatch, null);
  assert.deepEqual(result.appliedFilters, INCIDENT_FILTERS);
  assert.equal(suggested, false, "did-you-mean must not run once the head recovery found rows");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].query, "คอมแอร์ดีแมคปี 2008");
  assert.equal(calls[1].query, "คอมแอร์");
  assert.deepEqual(filtersOf(calls[1]), filtersOf(calls[0]), "recovery keeps every filter and anchor");
  assert.equal(calls[1].fitmentYear, 2008);
});

test("a search that already found rows never runs the recovery", async () => {
  const calls: SearchCall[] = [];
  const result = await searchChatProductInquiry(
    incidentInput({ text: "คอมแอร์ ดีแมค ปี 2008" }),
    catalogStub(calls, { "คอมแอร์ ดีแมค ปี 2008": ["P0029", "P0425"] }),
  );

  assert.equal(calls.length, 1);
  assert.equal(result.searched && result.categoryHeadRecovered, false);
  assert.equal(result.searched && result.reason, "SEARCHED_PRODUCT_INQUIRY");
});

test("no car model → no recovery; did-you-mean runs as before", async () => {
  const calls: SearchCall[] = [];
  let suggested = false;
  const result = await searchChatProductInquiry(
    incidentInput({ fitmentHints: { ...INCIDENT_FILTERS, carBrandName: null, carModelName: null } }),
    catalogStub(calls, { "คอมแอร์": ["P0425", "P0029"] }),
    async () => {
      suggested = true;
      return [];
    },
  );

  assert.equal(calls.length, 1, "category alone is too broad for the recovery");
  assert.equal(suggested, true);
  assert.equal(result.searched && result.categoryHeadRecovered, false);
});

test("recovery that also finds nothing falls through to did-you-mean unchanged", async () => {
  const calls: SearchCall[] = [];
  let suggested = false;
  const result = await searchChatProductInquiry(
    incidentInput(),
    catalogStub(calls, {}),
    async () => {
      suggested = true;
      return [];
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].query, "คอมแอร์");
  assert.equal(suggested, true);
  assert.equal(result.searched && result.categoryHeadRecovered, false);
  assert.equal(result.searched && result.query, "คอมแอร์ดีแมคปี 2008");
  assert.equal(result.searched && result.needsMoreInfo, true);
});

test("a code the customer typed stays a hard anchor in the recovery", async () => {
  const calls: SearchCall[] = [];
  await searchChatProductInquiry(
    incidentInput({ text: "คอมแอร์ดีแมค 10PA15", customerText: "คอมแอร์ดีแมค10PA15" }),
    catalogStub(calls, { "คอมแอร์": ["P0029"] }),
  );

  assert.equal(calls.length, 2);
  assert.ok((calls[0].requiredTokens ?? []).length > 0, "the typed code is a required token");
  assert.deepEqual(calls[1].requiredTokens, calls[0].requiredTokens);
});

test("a query that already is the category head is not searched twice", async () => {
  const calls: SearchCall[] = [];
  await searchChatProductInquiry(
    incidentInput({ text: "คอมแอร์", customerText: "คอมแอร์" }),
    catalogStub(calls, {}),
    async () => [],
  );

  assert.equal(calls.length, 1);
});

test("the category head strips only the trailing English gloss", async () => {
  const calls: SearchCall[] = [];
  await searchChatProductInquiry(
    incidentInput({
      text: "แผงคอยร้อนCX5ปี 2014",
      customerText: "แผงคอยร้อนCX5ปี14",
      fitmentHints: {
        categoryName: "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)",
        carBrandName: "Mazda",
        carModelName: "CX-5",
        fitmentYear: 2014,
      },
    }),
    catalogStub(calls, {}),
    async () => [],
  );

  assert.equal(calls[1].query, "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์");
});
