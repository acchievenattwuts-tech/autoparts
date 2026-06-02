import { createHmac } from "node:crypto";

/**
 * Shopee Open Platform API v2 request signing.
 *
 * All functions here are PURE (no I/O, no env reads) so they can be unit-tested
 * against fixed fixtures. See `lib/shopee/__tests__/signature.test.ts`.
 *
 * Shopee v2 signing rules (HMAC-SHA256 of a base string, hex lowercase):
 *  - Public APIs   (auth/token/shop authorization):
 *      base = partner_id + api_path + timestamp
 *  - Shop APIs     (most order/item/logistics calls):
 *      base = partner_id + api_path + timestamp + access_token + shop_id
 *  - Merchant APIs (cross-border merchant scope):
 *      base = partner_id + api_path + timestamp + access_token + merchant_id
 *
 * `timestamp` is Unix time in SECONDS.
 */

/** Low-level HMAC-SHA256 → lowercase hex. */
export function hmacSha256Hex(baseString: string, partnerKey: string): string {
  return createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

/** Current Unix timestamp in seconds (Shopee expects seconds, not ms). */
export function shopeeTimestamp(now: number = Date.now()): number {
  return Math.floor(now / 1000);
}

export function buildPublicBaseString(
  partnerId: number,
  apiPath: string,
  timestamp: number,
): string {
  return `${partnerId}${apiPath}${timestamp}`;
}

export function buildShopBaseString(
  partnerId: number,
  apiPath: string,
  timestamp: number,
  accessToken: string,
  shopId: number,
): string {
  return `${partnerId}${apiPath}${timestamp}${accessToken}${shopId}`;
}

export function buildMerchantBaseString(
  partnerId: number,
  apiPath: string,
  timestamp: number,
  accessToken: string,
  merchantId: number,
): string {
  return `${partnerId}${apiPath}${timestamp}${accessToken}${merchantId}`;
}

export function signPublic(
  partnerId: number,
  apiPath: string,
  timestamp: number,
  partnerKey: string,
): string {
  return hmacSha256Hex(buildPublicBaseString(partnerId, apiPath, timestamp), partnerKey);
}

export function signShop(
  partnerId: number,
  apiPath: string,
  timestamp: number,
  accessToken: string,
  shopId: number,
  partnerKey: string,
): string {
  return hmacSha256Hex(
    buildShopBaseString(partnerId, apiPath, timestamp, accessToken, shopId),
    partnerKey,
  );
}

export function signMerchant(
  partnerId: number,
  apiPath: string,
  timestamp: number,
  accessToken: string,
  merchantId: number,
  partnerKey: string,
): string {
  return hmacSha256Hex(
    buildMerchantBaseString(partnerId, apiPath, timestamp, accessToken, merchantId),
    partnerKey,
  );
}

export type ShopeeCommonQuery = {
  partner_id: number;
  timestamp: number;
  sign: string;
  access_token?: string;
  shop_id?: number;
  merchant_id?: number;
};

/** Common query params for a PUBLIC (unauthenticated) Shopee call. */
export function buildPublicQuery(
  partnerId: number,
  apiPath: string,
  partnerKey: string,
  timestamp: number = shopeeTimestamp(),
): ShopeeCommonQuery {
  return {
    partner_id: partnerId,
    timestamp,
    sign: signPublic(partnerId, apiPath, timestamp, partnerKey),
  };
}

/** Common query params for a SHOP-scoped authenticated Shopee call. */
export function buildShopQuery(
  partnerId: number,
  apiPath: string,
  partnerKey: string,
  accessToken: string,
  shopId: number,
  timestamp: number = shopeeTimestamp(),
): ShopeeCommonQuery {
  return {
    partner_id: partnerId,
    timestamp,
    access_token: accessToken,
    shop_id: shopId,
    sign: signShop(partnerId, apiPath, timestamp, accessToken, shopId, partnerKey),
  };
}

/**
 * Turns common query params into a URLSearchParams-ready record (all strings).
 * Undefined fields are omitted.
 */
export function toQueryRecord(query: ShopeeCommonQuery): Record<string, string> {
  const record: Record<string, string> = {
    partner_id: String(query.partner_id),
    timestamp: String(query.timestamp),
    sign: query.sign,
  };
  if (query.access_token !== undefined) record.access_token = query.access_token;
  if (query.shop_id !== undefined) record.shop_id = String(query.shop_id);
  if (query.merchant_id !== undefined) record.merchant_id = String(query.merchant_id);
  return record;
}
