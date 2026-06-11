import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent } from "@/lib/generated/prisma";
import {
  GUARD_GROUPS,
  groupToRoute,
  intentToGroup,
  isLineMessageGroup,
} from "@/lib/line-intent-groups";

test("guard groups are exactly the money/commitment intents", () => {
  assert.deepEqual(
    [...GUARD_GROUPS].sort(),
    ["claim_or_return", "payment", "price_negotiation", "purchase"],
  );
});

test("product group maps to a searchable route; shop_info does not", () => {
  assert.equal(groupToRoute("product")?.intent, LineIntent.PRODUCT_INQUIRY_TEXT);
  assert.equal(groupToRoute("product")?.allowsSearch, true);
  assert.equal(groupToRoute("shop_info")?.intent, LineIntent.SHOP_INFO);
  assert.equal(groupToRoute("shop_info")?.allowsSearch, false);
});

test("ack+handoff groups require admin", () => {
  assert.equal(groupToRoute("payment")?.requiresAdmin, true);
  assert.equal(groupToRoute("claim_or_return")?.intent, LineIntent.CLAIM_OR_RETURN);
  assert.equal(groupToRoute("purchase")?.intent, LineIntent.PURCHASE_INTENT);
});

test("flag-driven groups have no 1:1 route", () => {
  assert.equal(groupToRoute("general_faq"), null);
  assert.equal(groupToRoute("other"), null);
  assert.equal(groupToRoute("social"), null);
  assert.equal(groupToRoute("smalltalk"), null);
  assert.equal(groupToRoute("out_of_scope"), null);
});

test("smalltalk and out_of_scope are valid non-product groups", () => {
  assert.equal(isLineMessageGroup("smalltalk"), true);
  assert.equal(isLineMessageGroup("out_of_scope"), true);
});

test("intentToGroup round-trips the regex intents (UNKNOWN → other)", () => {
  assert.equal(intentToGroup(LineIntent.PAYMENT_SLIP_IMAGE), "payment");
  assert.equal(intentToGroup(LineIntent.SHOP_INFO), "shop_info");
  assert.equal(intentToGroup(LineIntent.PRODUCT_INQUIRY_TEXT), "product");
  assert.equal(intentToGroup(LineIntent.PART_IMAGE_INQUIRY), "product");
  assert.equal(intentToGroup(LineIntent.UNKNOWN), "other");
});

test("isLineMessageGroup validates membership", () => {
  assert.equal(isLineMessageGroup("product"), true);
  assert.equal(isLineMessageGroup("other"), true);
  assert.equal(isLineMessageGroup("nope"), false);
  assert.equal(isLineMessageGroup(123), false);
});
