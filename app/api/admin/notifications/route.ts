export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";

/**
 * Per-user in-app notification feed for the header bell.
 * GET ?mode=summary → { unreadCount }
 * GET ?mode=list&take=N → { items }
 * POST { action: "markRead", id } | { action: "markAllRead" }
 *
 * Read state lives in the DB; each user only ever sees/affects their own rows.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const userId = session.user.id;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "summary";

  if (mode === "list") {
    const take = Number(url.searchParams.get("take") ?? "10");
    const items = await listNotifications(userId, { take: Number.isFinite(take) ? take : 10 });
    return Response.json({ items });
  }

  const unreadCount = await getUnreadNotificationCount(userId);
  return Response.json({ unreadCount });
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const userId = session.user.id;
  const body = (await request.json().catch(() => null)) as { action?: string; id?: string } | null;

  if (body?.action === "markAllRead") {
    const count = await markAllNotificationsRead(userId);
    return Response.json({ ok: true, count });
  }
  if (body?.action === "markRead" && typeof body.id === "string") {
    await markNotificationRead(userId, body.id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
}
