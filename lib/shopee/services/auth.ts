import { db } from "@/lib/db";
import { AuditAction, ShopeeAuthStatus, ShopeeSyncJobType } from "@/lib/generated/prisma";
import { safeWriteAuditLog, type AuditLogActor } from "@/lib/audit-log";
import { createShopeeClient } from "@/lib/shopee/client";
import { getRequiredShopeeConfig } from "@/lib/shopee/config";
import { shopeeTimestamp, signPublic } from "@/lib/shopee/signature";
import { withShopeeSyncLock } from "@/lib/shopee/sync-lock";
import type {
  ShopeeRefreshTokenResponse,
  ShopeeTokenGetResponse,
} from "@/lib/shopee/types";

/**
 * Shopee shop authorization & token lifecycle (Phase C core).
 *
 * ISOLATION: touches only the new `ShopeeShop` table + AuditLog. No existing
 * business logic is imported or mutated. Tokens are stored server-side only and
 * never returned to the client; audit entries redact them via audit-log helpers.
 */

const AUTH_PARTNER_PATH = "/api/v2/shop/auth_partner";
const TOKEN_GET_PATH = "/api/v2/auth/token/get";
const TOKEN_REFRESH_PATH = "/api/v2/auth/access_token/get";

/** Refresh proactively when the access token has <= this many ms of life left. */
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Builds the Shopee shop-authorization URL. The merchant is redirected here to
 * grant access; Shopee then calls back `SHOPEE_REDIRECT_URL?code=...&shop_id=...`.
 */
export function buildShopAuthorizationUrl(state?: string): string {
  const config = getRequiredShopeeConfig();
  const timestamp = shopeeTimestamp();
  const sign = signPublic(config.partnerId, AUTH_PARTNER_PATH, timestamp, config.partnerKey);

  const url = new URL(AUTH_PARTNER_PATH, config.host);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("redirect", config.redirectUrl);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export type ShopAuthResult = {
  shopRecordId: string;
  shopId: string;
  accessToken: string;
  tokenExpiresAt: Date;
};

/**
 * Exchanges an authorization `code` for access/refresh tokens and upserts the
 * shop record. Idempotent on `shopId` (re-authorizing the same shop updates it).
 */
export async function exchangeCodeForTokens(params: {
  code: string;
  shopId: string;
  actor?: AuditLogActor;
}): Promise<ShopAuthResult> {
  const config = getRequiredShopeeConfig();
  const client = createShopeeClient();

  const response = await client.callPublic<ShopeeTokenGetResponse>(TOKEN_GET_PATH, {
    method: "POST",
    body: {
      code: params.code,
      shop_id: Number(params.shopId),
      partner_id: config.partnerId,
    },
  });

  const now = new Date();
  const tokenExpiresAt = new Date(now.getTime() + response.expire_in * 1000);

  const shop = await db.shopeeShop.upsert({
    where: { shopId: params.shopId },
    update: {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenExpiresAt,
      authStatus: ShopeeAuthStatus.AUTHORIZED,
      authorizedAt: now,
      authorizedByUserId: params.actor?.userId ?? null,
      lastError: null,
    },
    create: {
      shopId: params.shopId,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenExpiresAt,
      authStatus: ShopeeAuthStatus.AUTHORIZED,
      authorizedAt: now,
      authorizedByUserId: params.actor?.userId ?? null,
    },
    select: { id: true, shopId: true },
  });

  await safeWriteAuditLog({
    ...params.actor,
    action: AuditAction.CREATE,
    entityType: "ShopeeShop",
    entityId: shop.id,
    entityRef: shop.shopId,
    meta: { event: "SHOPEE_AUTHORIZE", tokenExpiresAt: tokenExpiresAt.toISOString() },
  });

  return { shopRecordId: shop.id, shopId: shop.shopId, accessToken: response.access_token, tokenExpiresAt };
}

/**
 * Refreshes the access token for a shop using its stored refresh token.
 * On failure, marks the shop EXPIRED and records the error (no secrets logged).
 */
export async function refreshShopAccessToken(
  shopRecordId: string,
  actor?: AuditLogActor,
): Promise<ShopAuthResult> {
  const config = getRequiredShopeeConfig();
  const shop = await db.shopeeShop.findUnique({
    where: { id: shopRecordId },
    select: { id: true, shopId: true, refreshToken: true },
  });

  if (!shop?.refreshToken) {
    throw new Error("SHOPEE_SHOP_NOT_AUTHORIZED");
  }

  const client = createShopeeClient();
  try {
    const response = await client.callPublic<ShopeeRefreshTokenResponse>(TOKEN_REFRESH_PATH, {
      method: "POST",
      body: {
        refresh_token: shop.refreshToken,
        shop_id: Number(shop.shopId),
        partner_id: config.partnerId,
      },
    });

    const tokenExpiresAt = new Date(Date.now() + response.expire_in * 1000);
    await db.shopeeShop.update({
      where: { id: shop.id },
      data: {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenExpiresAt,
        authStatus: ShopeeAuthStatus.AUTHORIZED,
        lastError: null,
      },
    });

    await safeWriteAuditLog({
      ...actor,
      action: AuditAction.UPDATE,
      entityType: "ShopeeShop",
      entityId: shop.id,
      entityRef: shop.shopId,
      meta: { event: "SHOPEE_TOKEN_REFRESH", tokenExpiresAt: tokenExpiresAt.toISOString() },
    });

    return { shopRecordId: shop.id, shopId: shop.shopId, accessToken: response.access_token, tokenExpiresAt };
  } catch (error) {
    await db.shopeeShop.update({
      where: { id: shop.id },
      data: {
        authStatus: ShopeeAuthStatus.EXPIRED,
        lastError: error instanceof Error ? error.message : "token refresh failed",
      },
    });
    throw error;
  }
}

/**
 * Refresh guarded by a per-shop sync lock so concurrent callers do not refresh
 * twice. Shopee rotates the `refresh_token` on every refresh, so a duplicate
 * refresh can invalidate the token that another caller is about to store.
 * Returns `refreshed: false` when another refresh was already in progress
 * (skipped) — the caller should then re-read the current token, which is still
 * valid because we refresh inside a 10-minute pre-expiry buffer.
 *
 * NOTE: the lock is check-then-create, so a sub-millisecond double-acquire is
 * still theoretically possible; this shrinks the race window from the whole
 * 10-minute buffer to a few milliseconds.
 */
export async function refreshShopAccessTokenGuarded(
  shopRecordId: string,
  actor?: AuditLogActor,
): Promise<{ refreshed: boolean; auth: ShopAuthResult | null }> {
  const outcome = await withShopeeSyncLock(
    { shopRecordId, type: ShopeeSyncJobType.TOKEN_REFRESH },
    async () => {
      const auth = await refreshShopAccessToken(shopRecordId, actor);
      return { value: auth };
    },
  );
  if (outcome.skipped) return { refreshed: false, auth: null };
  return { refreshed: true, auth: outcome.result };
}

/**
 * Returns a valid access token for a shop, refreshing first if it is missing or
 * about to expire. Use this before every Shopee shop-scoped API call.
 */
export async function getValidShopAuth(
  shopRecordId: string,
): Promise<{ accessToken: string; shopId: number }> {
  const shop = await db.shopeeShop.findUnique({
    where: { id: shopRecordId },
    select: { id: true, shopId: true, accessToken: true, tokenExpiresAt: true, authStatus: true },
  });

  if (!shop) throw new Error("SHOPEE_SHOP_NOT_FOUND");

  const accessToken = shop.accessToken;
  const isExpiringSoon =
    !shop.tokenExpiresAt ||
    shop.tokenExpiresAt.getTime() - Date.now() <= TOKEN_REFRESH_BUFFER_MS;

  if (!accessToken || isExpiringSoon) {
    // Guarded so simultaneous calls during the expiry window refresh only once.
    const refreshResult = await refreshShopAccessTokenGuarded(shopRecordId);
    if (refreshResult.auth?.accessToken) {
      return { accessToken: refreshResult.auth.accessToken, shopId: Number(refreshResult.auth.shopId) };
    }

    // If the guarded refresh was skipped, another process owns the refresh and
    // we re-read once to pick up the token it stored.
    const refreshed = await db.shopeeShop.findUnique({
      where: { id: shopRecordId },
      select: { shopId: true, accessToken: true },
    });
    if (!refreshed?.accessToken) throw new Error("SHOPEE_TOKEN_UNAVAILABLE");
    return { accessToken: refreshed.accessToken, shopId: Number(refreshed.shopId) };
  }

  return { accessToken, shopId: Number(shop.shopId) };
}
