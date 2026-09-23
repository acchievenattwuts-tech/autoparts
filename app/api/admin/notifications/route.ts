export const dynamic = "force-dynamic";

import { z } from "zod";

import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";
import { getRequiredSession } from "@/lib/require-auth";

const DEFAULT_LIST_TAKE = 10;

const postBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("markAllRead") }),
  z.object({ action: z.literal("markRead"), id: z.string() }),
]);

/**
 * Resolves the signed-in user, or null when there is no session or it was
 * revoked (user deactivated / password or role changed → sessionInvalid).
 * /api/admin is outside the proxy matcher, so this is the only gate.
 */
async function getNotificationUserId(): Promise<string | null> {
  try {
    const session = await getRequiredSession();
    return session.user.id;
  } catch {
    return null;
  }
}

const unauthorized = () => Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
const internalError = () => Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });

/**
 * Per-user in-app notification feed for the header bell.
 * GET ?mode=summary → { unreadCount }
 * GET ?mode=list&take=N → { items }
 * POST { action: "markRead", id } | { action: "markAllRead" }
 *
 * Read state lives in the DB; each user only ever sees/affects their own rows.
 */
export async function GET(request: Request): Promise<Response> {
  const userId = await getNotificationUserId();
  if (!userId) return unauthorized();

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "summary";

  try {
    if (mode === "list") {
      const take = Number(url.searchParams.get("take") ?? String(DEFAULT_LIST_TAKE));
      const items = await listNotifications(userId, { take: Number.isFinite(take) ? take : DEFAULT_LIST_TAKE });
      return Response.json({ items });
    }

    const unreadCount = await getUnreadNotificationCount(userId);
    return Response.json({ unreadCount });
  } catch (error) {
    console.error("[notifications] feed read failed", error);
    return internalError();
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getNotificationUserId();
  if (!userId) return unauthorized();

  const parsed = postBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
  }

  try {
    if (parsed.data.action === "markAllRead") {
      const count = await markAllNotificationsRead(userId);
      return Response.json({ ok: true, count });
    }
    await markNotificationRead(userId, parsed.data.id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[notifications] mark read failed", error);
    return internalError();
  }
}
