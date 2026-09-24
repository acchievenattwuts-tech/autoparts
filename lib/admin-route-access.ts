import {
  getRoutePermission,
  isKnowledgePermission,
  type PermissionKey,
} from "@/lib/access-control";

/**
 * The route-level authorization decision for /admin, lifted out of the NextAuth
 * `authorized()` callback so it can be tested directly.
 *
 * This is the outermost gate on every admin page — the one thing standing
 * between an unauthenticated request and a page render — and it had no test
 * coverage at all. The logic here is a line-for-line transcription of the
 * previous inline callback; `authorized()` now only turns these decisions into
 * `Response.redirect(...)` / boolean, which is the part that needs a real
 * request to exercise.
 *
 * Ordering is significant and deliberately preserved:
 *   1. /admin/login is handled BEFORE the generic /admin branch, because it
 *      also starts with /admin and must stay reachable while logged out.
 *   2. The forced password change outranks every permission check, so a user
 *      who must rotate their password cannot detour into another page first.
 *   3. ADMIN bypasses permissions EXCEPT for knowledge.* routes, which require
 *      an explicit grant even for admins.
 */

export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_CHANGE_PASSWORD_PATH = "/admin/profile/change-password";

export type AdminRouteAccessInput = {
  pathname: string;
  isLoggedIn: boolean;
  isAdmin: boolean;
  hasAppRole: boolean;
  mustChangePassword: boolean;
  sessionInvalid: boolean;
  permissions: readonly string[];
};

export type AdminRouteAccessDecision =
  | { type: "allow" }
  | { type: "deny" }
  | { type: "redirect"; to: string };

/**
 * Pages whose own requirePermission() key differs from the prefix rule that
 * getRoutePermission() would apply (e.g. /admin/sales/shopee/settlements sits
 * under the /admin/sales prefix = sales.view, but the page itself only checks
 * marketplace.manage). Since the proxy now really enforces "deny", the route
 * gate must never demand a key the page does not demand, or someone the page
 * lets in would be blocked. Each override is a key the page itself requires.
 * lib/__tests__/admin-route-access-page-parity.test.ts keeps this in sync.
 */
const PAGE_PERMISSION_OVERRIDES: ReadonlyArray<{ pattern: RegExp; permission: PermissionKey }> = [
  { pattern: /^\/admin\/sales\/(?:shopee|lazada)\/new$/, permission: "sales.create" },
  { pattern: /^\/admin\/sales\/(?:shopee|lazada)\/returns\/new$/, permission: "credit_notes.create" },
  { pattern: /^\/admin\/sales\/(?:shopee|lazada)\/settlements$/, permission: "marketplace.manage" },
  { pattern: /^\/admin\/marketplace\/settlements(?:\/|$)/, permission: "marketplace.manage" },
  { pattern: /^\/admin\/knowledge\/test$/, permission: "knowledge.sync" },
  { pattern: /^\/admin\/wht\/certificates\/new$/, permission: "wht.create" },
  { pattern: /^\/admin\/wht\/filings\/new$/, permission: "wht_filings.manage" },
];

/** The permission the route gate requires for an admin path (see overrides above). */
export const resolveAdminRoutePermission = (pathname: string): PermissionKey | null | undefined =>
  PAGE_PERMISSION_OVERRIDES.find((override) => override.pattern.test(pathname))?.permission ??
  getRoutePermission(pathname);

const ALLOW: AdminRouteAccessDecision = { type: "allow" };
const DENY: AdminRouteAccessDecision = { type: "deny" };
const redirectTo = (to: string): AdminRouteAccessDecision => ({ type: "redirect", to });

export const decideAdminRouteAccess = (
  input: AdminRouteAccessInput,
): AdminRouteAccessDecision => {
  const {
    pathname,
    isLoggedIn,
    isAdmin,
    hasAppRole,
    mustChangePassword,
    sessionInvalid,
    permissions,
  } = input;

  const isAdminRoute = pathname.startsWith("/admin");
  const isLoginPage = pathname === ADMIN_LOGIN_PATH;
  const isChangePasswordPage = pathname === ADMIN_CHANGE_PASSWORD_PATH;
  const requiredPermission = resolveAdminRoutePermission(pathname);

  // Already signed in and still valid? Bounce off the login form. A revoked
  // session must fall through and be allowed to render the form again,
  // otherwise the user is trapped in a redirect loop with no way to sign in.
  if (isLoginPage) {
    if (!sessionInvalid && (isAdmin || hasAppRole)) {
      return redirectTo(mustChangePassword ? ADMIN_CHANGE_PASSWORD_PATH : ADMIN_HOME_PATH);
    }
    return ALLOW;
  }

  if (isAdminRoute) {
    if (!isLoggedIn || sessionInvalid) return redirectTo(ADMIN_LOGIN_PATH);
    if (mustChangePassword && !isChangePasswordPage) {
      return redirectTo(ADMIN_CHANGE_PASSWORD_PATH);
    }
    // ADMIN skips permission checks everywhere except knowledge.*, which stays
    // grant-only even for admins.
    if (isAdmin && !(requiredPermission && isKnowledgePermission(requiredPermission))) {
      return ALLOW;
    }
    // A non-admin with no app role has no permissions to check against.
    if (!hasAppRole && !isAdmin) return DENY;
    // No rule matched this admin path: fail closed. A newly added menu that
    // nobody registered in ADMIN_ROUTE_RULES is denied rather than exposed.
    if (typeof requiredPermission === "undefined") return DENY;
    // Rule matched and is explicitly open to any role holder.
    if (requiredPermission === null) return ALLOW;
    return permissions.includes(requiredPermission) ? ALLOW : DENY;
  }

  return ALLOW;
};
