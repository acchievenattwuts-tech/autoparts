export const dynamic = "force-dynamic";

import {
  classifyAdminSession,
  type AdminSessionStatusBody,
} from "@/lib/admin-session-watch";
import { getSession } from "@/lib/auth-session";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

const respond = (body: AdminSessionStatusBody, status: number): Response =>
  Response.json(body, { status, headers: NO_STORE_HEADERS });

/**
 * Polled by AdminSessionWatcher so an idle admin tab learns that its session
 * ended elsewhere (password/role change, account disabled, signed out).
 * GET → 200 { ok: true } | 401 { ok: false, reason } | 503 when unverifiable.
 *
 * /api/admin is outside the proxy matcher, so this route is its own gate. It
 * reads the session only: auth() without a request never re-issues the cookie,
 * so polling does not stretch the 7-day idle window in auth.config.ts.
 */
export async function GET(): Promise<Response> {
  try {
    const state = classifyAdminSession(await getSession());
    if (state === "active") return respond({ ok: true }, 200);
    if (state === "unverified") return respond({ ok: false, error: "SESSION_CHECK_UNAVAILABLE" }, 503);
    return respond({ ok: false, reason: state }, 401);
  } catch (error) {
    console.error("[session-status] check failed", error);
    return respond({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
}
