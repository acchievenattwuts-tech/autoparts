import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicBaseString,
  buildShopBaseString,
  buildPublicQuery,
  buildShopQuery,
  hmacSha256Hex,
  shopeeTimestamp,
  signPublic,
  signShop,
  toQueryRecord,
} from "../signature";

// Fixed fixtures. Golden signatures were produced with node:crypto against the
// exact base strings below — see lib/shopee/signature.ts for the v2 rules.
const PARTNER_ID = 123456;
const PARTNER_KEY = "shpk_test_partner_key_demo";
const TIMESTAMP = 1_700_000_000;
const ACCESS_TOKEN = "access_tok_demo";
const SHOP_ID = 222333;

const PUBLIC_PATH = "/api/v2/auth/token/get";
const SHOP_PATH = "/api/v2/order/get_order_list";

const GOLDEN_PUBLIC_SIGN =
  "1c7c1b9994a0dd57c90b21b9097fb1bf00c9cbc9ddc7ad44912daabe3c03246e";
const GOLDEN_SHOP_SIGN =
  "4641c8ac532efdebdc1c71a2cbbe2cd717acb4aa7fcda490c7d258d9db3cb998";

test("buildPublicBaseString concatenates partner_id + path + timestamp", () => {
  assert.equal(
    buildPublicBaseString(PARTNER_ID, PUBLIC_PATH, TIMESTAMP),
    `${PARTNER_ID}${PUBLIC_PATH}${TIMESTAMP}`,
  );
});

test("buildShopBaseString appends access_token + shop_id", () => {
  assert.equal(
    buildShopBaseString(PARTNER_ID, SHOP_PATH, TIMESTAMP, ACCESS_TOKEN, SHOP_ID),
    `${PARTNER_ID}${SHOP_PATH}${TIMESTAMP}${ACCESS_TOKEN}${SHOP_ID}`,
  );
});

test("signPublic matches golden HMAC-SHA256 hex", () => {
  assert.equal(
    signPublic(PARTNER_ID, PUBLIC_PATH, TIMESTAMP, PARTNER_KEY),
    GOLDEN_PUBLIC_SIGN,
  );
});

test("signShop matches golden HMAC-SHA256 hex", () => {
  assert.equal(
    signShop(PARTNER_ID, SHOP_PATH, TIMESTAMP, ACCESS_TOKEN, SHOP_ID, PARTNER_KEY),
    GOLDEN_SHOP_SIGN,
  );
});

test("hmacSha256Hex is deterministic and lowercase hex", () => {
  const a = hmacSha256Hex("hello", "key");
  const b = hmacSha256Hex("hello", "key");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("shopeeTimestamp converts ms → whole seconds", () => {
  assert.equal(shopeeTimestamp(1_700_000_000_500), 1_700_000_000);
});

test("buildPublicQuery produces signed common params without secrets", () => {
  const query = buildPublicQuery(PARTNER_ID, PUBLIC_PATH, PARTNER_KEY, TIMESTAMP);
  assert.equal(query.partner_id, PARTNER_ID);
  assert.equal(query.timestamp, TIMESTAMP);
  assert.equal(query.sign, GOLDEN_PUBLIC_SIGN);
  assert.equal(query.access_token, undefined);
  assert.equal(query.shop_id, undefined);
});

test("buildShopQuery includes access_token + shop_id", () => {
  const query = buildShopQuery(
    PARTNER_ID,
    SHOP_PATH,
    PARTNER_KEY,
    ACCESS_TOKEN,
    SHOP_ID,
    TIMESTAMP,
  );
  assert.equal(query.sign, GOLDEN_SHOP_SIGN);
  assert.equal(query.access_token, ACCESS_TOKEN);
  assert.equal(query.shop_id, SHOP_ID);
});

test("toQueryRecord stringifies and omits undefined fields", () => {
  const record = toQueryRecord({
    partner_id: PARTNER_ID,
    timestamp: TIMESTAMP,
    sign: GOLDEN_PUBLIC_SIGN,
  });
  assert.deepEqual(record, {
    partner_id: String(PARTNER_ID),
    timestamp: String(TIMESTAMP),
    sign: GOLDEN_PUBLIC_SIGN,
  });
  assert.equal("access_token" in record, false);
});
