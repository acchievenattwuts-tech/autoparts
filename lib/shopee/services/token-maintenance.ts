import { db } from "@/lib/db";
import { NotificationSeverity, NotificationType, ShopeeAuthStatus } from "@/lib/generated/prisma";
import { createNotification } from "@/lib/notifications";
import { refreshShopAccessTokenGuarded } from "@/lib/shopee/services/auth";

/**
 * Proactive token maintenance (called by the QStash-scheduled cron endpoint).
 *
 * `getValidShopAuth()` already refreshes on demand before any API call, so this
 * is a reliability layer: it refreshes tokens close to expiry ahead of time and
 * raises an in-app notification when a refresh fails, so the owner can
 * re-authorize before sync breaks.
 */

// Refresh when <= 90 min of life left. Larger than the hourly Vercel Cron
// interval (vercel.json) so a token can never expire between two runs.
const DEFAULT_THRESHOLD_MS = 90 * 60 * 1000;

export type TokenMaintenanceResult = {
  checked: number;
  refreshed: number;
  failed: number;
};

export async function refreshExpiringShopTokens(
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): Promise<TokenMaintenanceResult> {
  const cutoff = new Date(Date.now() + thresholdMs);

  const shops = await db.shopeeShop.findMany({
    where: {
      authStatus: ShopeeAuthStatus.AUTHORIZED,
      refreshToken: { not: null },
      tokenExpiresAt: { lte: cutoff },
    },
    select: { id: true, shopId: true },
  });

  let refreshed = 0;
  let failed = 0;

  for (const shop of shops) {
    try {
      // Guarded: skip if another process (or getValidShopAuth) is already
      // refreshing this shop — avoids double-refresh invalidating the token.
      const { refreshed: didRefresh } = await refreshShopAccessTokenGuarded(shop.id);
      if (didRefresh) refreshed += 1;
    } catch {
      failed += 1;
      await createNotification({
        type: NotificationType.SHOPEE_TOKEN_EXPIRING,
        severity: NotificationSeverity.ERROR,
        title: "Token Shopee ใกล้หมดอายุและ refresh ไม่สำเร็จ",
        body: `ร้าน ${shop.shopId} ต้องเชื่อมต่อใหม่เพื่อให้ sync ทำงานต่อได้`,
        link: "/admin/marketplace/shopee",
        entityType: "ShopeeShop",
        entityId: shop.id,
        dedupeKey: `shopee-token-expiring:${shop.id}`,
      }).catch(() => undefined);
    }
  }

  return { checked: shops.length, refreshed, failed };
}
