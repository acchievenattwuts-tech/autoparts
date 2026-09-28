/**
 * Shared rules for bouncing an open admin tab to the login page once its
 * session has ended somewhere else (password changed on another device, role
 * or permissions changed, account disabled, signed out in another tab).
 *
 * Every one of those bumps User.authVersion or clears the cookie, and the
 * proxy already rejects the next /admin request. What was missing is a tab
 * that just sits open: it never makes that request, so it never finds out.
 * AdminSessionWatcher polls /api/admin/session-status and uses these helpers.
 *
 * Client-safe on purpose: no DB or server-only imports (lib/admin-route-access
 * pulls in lib/db through access-control, so the login path is repeated here
 * and kept equal by lib/__tests__/admin-session-watch.test.ts).
 */
import type { Session } from "next-auth";

export const ADMIN_SESSION_STATUS_PATH = "/api/admin/session-status";

export const ADMIN_SESSION_WATCH_LOGIN_PATH = "/admin/login";
export const ADMIN_SESSION_END_REASON_PARAM = "reason";

/** How often a visible admin tab asks whether its session is still valid. */
export const ADMIN_SESSION_CHECK_INTERVAL_MS = 30_000;

/** focus + visibilitychange usually fire together; one request covers both. */
export const ADMIN_SESSION_EVENT_CHECK_MIN_GAP_MS = 5_000;

/**
 * revoked — the session cookie is still there but the account changed
 *           (authVersion bumped or user disabled).
 * expired — no usable session at all (signed out, cookie expired or cleared).
 */
export type AdminSessionEndReason = "revoked" | "expired";

/** "unverified": the revocation lookup itself failed (DB unreachable). */
export type AdminSessionState = "active" | "unverified" | AdminSessionEndReason;

export type AdminSessionStatusBody =
  | { ok: true }
  | { ok: false; reason: AdminSessionEndReason }
  | { ok: false; error: string };

export const ADMIN_SESSION_END_MESSAGES: Record<AdminSessionEndReason, string> = {
  revoked:
    "บัญชีนี้ถูกออกจากระบบ เนื่องจากมีการเปลี่ยนรหัสผ่าน สิทธิ์การใช้งาน หรือสถานะบัญชี กรุณาเข้าสู่ระบบใหม่",
  expired: "เซสชันสิ้นสุดแล้ว (หมดอายุหรือออกจากระบบไปแล้ว) กรุณาเข้าสู่ระบบใหม่",
};

/**
 * Server side: what the session-status endpoint should report.
 * The jwt() callback fails closed (sessionInvalid) when the revocation lookup
 * throws; sessionCheckFailed separates that from a real revocation so a DB
 * blip does not throw every open tab out to the login page.
 */
export const classifyAdminSession = (session: Session | null): AdminSessionState => {
  if (!session?.user) return "expired";
  if (session.user.sessionCheckFailed) return "unverified";
  if (session.user.sessionInvalid) return "revoked";
  return "active";
};

const isAdminSessionEndReason = (value: unknown): value is AdminSessionEndReason =>
  value === "revoked" || value === "expired";

/**
 * Client side: whether a status response means "leave now", and why.
 * Only 401 ends the session. Network errors, 5xx and 503 (unverified) keep the
 * page open and the next check tries again.
 */
export const resolveAdminSessionEndReason = (
  status: number,
  body: unknown,
): AdminSessionEndReason | null => {
  if (status !== 401) return null;
  if (body && typeof body === "object" && "reason" in body && isAdminSessionEndReason(body.reason)) {
    return body.reason;
  }
  return "expired";
};

export const buildAdminSessionEndLoginPath = (reason: AdminSessionEndReason): string =>
  `${ADMIN_SESSION_WATCH_LOGIN_PATH}?${ADMIN_SESSION_END_REASON_PARAM}=${reason}`;

/** Login page: the notice to show for ?reason=…, or null for anything else. */
export const getAdminSessionEndMessage = (value: string | string[] | undefined): string | null => {
  const reason = Array.isArray(value) ? value[0] : value;
  return isAdminSessionEndReason(reason) ? ADMIN_SESSION_END_MESSAGES[reason] : null;
};

export const shouldCheckAdminSessionOnEvent = ({
  now,
  lastCheckedAt,
}: {
  now: number;
  lastCheckedAt: number;
}): boolean => now - lastCheckedAt >= ADMIN_SESSION_EVENT_CHECK_MIN_GAP_MS;
