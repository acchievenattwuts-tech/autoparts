export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { auth } from "@/auth";
import { getAuditActorFromSession } from "@/lib/audit-log";
import { NotificationSeverity, NotificationType } from "@/lib/generated/prisma";
import { createNotification } from "@/lib/notifications";
import { isShopeeConfigured } from "@/lib/shopee/config";
import { exchangeCodeForTokens } from "@/lib/shopee/services/auth";

const OVERVIEW_PATH = "/admin/marketplace/shopee";
const SHOPEE_OAUTH_STATE_COOKIE = "shopee_oauth_state";

/**
 * Shopee OAuth callback. Shopee redirects the admin's browser here with
 * `code` + `shop_id` after they approve authorization. We exchange the code for
 * tokens, store them, raise an in-app notification, and redirect back to the
 * overview page with a result flag.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  const overview = new URL(OVERVIEW_PATH, base);

  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/admin/login", base));
  }

  const role = session.user.role;
  const permissions = session.user.permissions ?? [];
  if (role !== "ADMIN" && !permissions.includes("marketplace.manage")) {
    overview.searchParams.set("error", "forbidden");
    return NextResponse.redirect(overview);
  }

  if (!isShopeeConfigured()) {
    overview.searchParams.set("error", "not_configured");
    return NextResponse.redirect(overview);
  }

  const code = url.searchParams.get("code");
  const shopId = url.searchParams.get("shop_id");
  const state = url.searchParams.get("state");
  if (!code || !shopId) {
    overview.searchParams.set("error", "missing_params");
    return NextResponse.redirect(overview);
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(SHOPEE_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(SHOPEE_OAUTH_STATE_COOKIE);
  if (!state || !expectedState || state !== expectedState) {
    overview.searchParams.set("error", "invalid_state");
    return NextResponse.redirect(overview);
  }

  try {
    const result = await exchangeCodeForTokens({
      code,
      shopId,
      actor: getAuditActorFromSession(session),
    });

    await createNotification({
      type: NotificationType.GENERAL,
      severity: NotificationSeverity.INFO,
      title: "เชื่อมต่อร้าน Shopee สำเร็จ",
      body: `ร้าน ${result.shopId} พร้อมใช้งานแล้ว`,
      link: OVERVIEW_PATH,
      entityType: "ShopeeShop",
      entityId: result.shopRecordId,
    }).catch(() => undefined);

    overview.searchParams.set("connected", "1");
    overview.searchParams.set("shop", result.shopId);
    return NextResponse.redirect(overview);
  } catch (error) {
    // Never leak the raw Shopee error / tokens to the client.
    console.error("[shopee] callback exchange failed:", error instanceof Error ? error.message : "unknown");
    overview.searchParams.set("error", "callback");
    return NextResponse.redirect(overview);
  }
}
