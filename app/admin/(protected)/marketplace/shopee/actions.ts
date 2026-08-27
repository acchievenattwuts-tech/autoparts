"use server";

import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction, NotificationSeverity, NotificationType, ShopeeAuthStatus } from "@/lib/generated/prisma";
import { createNotification } from "@/lib/notifications";
import { requirePermission } from "@/lib/require-auth";
import { isShopeeConfigured } from "@/lib/shopee/config";
import { buildShopAuthorizationUrl } from "@/lib/shopee/services/auth";

const OVERVIEW_PATH = "/admin/marketplace/shopee";
const SHOPEE_OAUTH_STATE_COOKIE = "shopee_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

/**
 * Starts Shopee shop authorization: records an audit trail then redirects the
 * admin to Shopee's consent screen. Shopee returns to /api/shopee/callback.
 */
export async function startShopeeAuthorization(): Promise<void> {
  const session = await requirePermission("marketplace.manage");

  if (!isShopeeConfigured()) {
    redirect(`${OVERVIEW_PATH}?error=not_configured`);
  }

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.UPDATE,
    entityType: "ShopeeShop",
    meta: { event: "SHOPEE_AUTH_START" },
  });

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(SHOPEE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  redirect(buildShopAuthorizationUrl(state));
}

/**
 * Disconnects a shop: marks it REVOKED and clears stored tokens. Does not call
 * Shopee (token revocation is initiated from the Shopee side); this stops the
 * app from using the credentials and surfaces the state to the owner.
 */
export async function disconnectShopeeShop(formData: FormData): Promise<void> {
  const session = await requirePermission("marketplace.manage");
  const shopRecordId = String(formData.get("shopRecordId") ?? "").trim();
  if (!shopRecordId) {
    redirect(`${OVERVIEW_PATH}?error=invalid`);
  }

  const shop = await db.shopeeShop.findUnique({
    where: { id: shopRecordId },
    select: { id: true, shopId: true },
  });
  if (!shop) {
    redirect(`${OVERVIEW_PATH}?error=not_found`);
  }

  await db.shopeeShop.update({
    where: { id: shop.id },
    data: {
      authStatus: ShopeeAuthStatus.REVOKED,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      syncEnabled: false,
    },
  });

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.UPDATE,
    entityType: "ShopeeShop",
    entityId: shop.id,
    entityRef: shop.shopId,
    meta: { event: "SHOPEE_REVOKE" },
  });

  await createNotification({
    type: NotificationType.SHOPEE_AUTH_REVOKED,
    severity: NotificationSeverity.WARNING,
    title: "ยกเลิกการเชื่อมต่อร้าน Shopee",
    body: `ร้าน ${shop.shopId} ถูกยกเลิกการเชื่อมต่อแล้ว`,
    link: OVERVIEW_PATH,
    entityType: "ShopeeShop",
    entityId: shop.id,
  }).catch(() => undefined);

  revalidatePath(OVERVIEW_PATH);
}

export type SettlementActionResult = { ok: true } | { ok: false; error: string };

/** Enables/disables automatic order pull (cron) for a shop. */
export async function setSyncEnabledAction(formData: FormData): Promise<SettlementActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการการตั้งค่า" };
  }

  const shopRecordId = String(formData.get("shopRecordId") ?? "").trim();
  const enabled = String(formData.get("enabled") ?? "") === "1";
  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน" };

  await db.shopeeShop.update({
    where: { id: shopRecordId },
    data: { syncEnabled: enabled },
  });

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.UPDATE,
    entityType: "ShopeeShop",
    entityId: shopRecordId,
    meta: { event: "SHOPEE_SET_SYNC_ENABLED", enabled },
  });

  revalidatePath(OVERVIEW_PATH);
  return { ok: true };
}
