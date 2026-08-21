import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_CHANGE_PASSWORD_PATH,
  ADMIN_HOME_PATH,
  ADMIN_LOGIN_PATH,
  decideAdminRouteAccess,
  type AdminRouteAccessInput,
} from "@/lib/admin-route-access";

// Golden suite for the outermost gate on /admin. Every admin page render is
// behind this decision, and it had no coverage before — including through a
// next-auth 5.0.0-beta.30 → beta.32 upgrade. The cases below pin each branch,
// with the fail-closed ones stated explicitly so a future refactor cannot
// quietly turn a denial into an allow.

const signedOut: AdminRouteAccessInput = {
  pathname: "/admin/products",
  isLoggedIn: false,
  isAdmin: false,
  hasAppRole: false,
  mustChangePassword: false,
  sessionInvalid: false,
  permissions: [],
};

const staff = (overrides: Partial<AdminRouteAccessInput> = {}): AdminRouteAccessInput => ({
  ...signedOut,
  isLoggedIn: true,
  hasAppRole: true,
  permissions: ["products.view"],
  ...overrides,
});

const admin = (overrides: Partial<AdminRouteAccessInput> = {}): AdminRouteAccessInput => ({
  ...signedOut,
  isLoggedIn: true,
  isAdmin: true,
  ...overrides,
});

// ── Public routes ───────────────────────────────────────────────────────────

test("non-admin paths are never gated by this decision", () => {
  assert.deepEqual(
    decideAdminRouteAccess({ ...signedOut, pathname: "/products" }),
    { type: "allow" },
  );
  assert.deepEqual(decideAdminRouteAccess({ ...signedOut, pathname: "/" }), { type: "allow" });
});

// Documented quirk, not an aspiration: the admin check is a plain
// `startsWith("/admin")`, so a sibling path that merely shares the prefix would
// be gated as admin. No such route exists (app/ has admin, products, product,
// knowledge, liff, about, faq, verify…), so this costs nothing today — but if
// one is ever added it will be locked behind the admin gate, and this test is
// where that shows up.
test("the admin gate matches on prefix, so a /admin-prefixed sibling is gated too", () => {
  assert.deepEqual(
    decideAdminRouteAccess({ ...signedOut, pathname: "/administrivia" }),
    { type: "redirect", to: ADMIN_LOGIN_PATH },
  );
});

// ── Login page ──────────────────────────────────────────────────────────────

test("the login page stays reachable while signed out", () => {
  assert.deepEqual(
    decideAdminRouteAccess({ ...signedOut, pathname: ADMIN_LOGIN_PATH }),
    { type: "allow" },
  );
});

test("a signed-in user is bounced off the login page to the admin home", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: ADMIN_LOGIN_PATH })),
    { type: "redirect", to: ADMIN_HOME_PATH },
  );
  assert.deepEqual(
    decideAdminRouteAccess(admin({ pathname: ADMIN_LOGIN_PATH })),
    { type: "redirect", to: ADMIN_HOME_PATH },
  );
});

test("bouncing off the login page respects a pending password change", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: ADMIN_LOGIN_PATH, mustChangePassword: true })),
    { type: "redirect", to: ADMIN_CHANGE_PASSWORD_PATH },
  );
});

// Without this, a user whose session was revoked is redirected away from the
// only page that could give them a new one — a loop with no way out.
test("a revoked session may still reach the login page", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: ADMIN_LOGIN_PATH, sessionInvalid: true })),
    { type: "allow" },
  );
});

test("a signed-in user with neither ADMIN nor an app role is not bounced", () => {
  assert.deepEqual(
    decideAdminRouteAccess({
      ...signedOut,
      pathname: ADMIN_LOGIN_PATH,
      isLoggedIn: true,
    }),
    { type: "allow" },
  );
});

// ── Authentication ──────────────────────────────────────────────────────────

test("an anonymous request to an admin page is sent to the login page", () => {
  assert.deepEqual(decideAdminRouteAccess(signedOut), {
    type: "redirect",
    to: ADMIN_LOGIN_PATH,
  });
});

test("a revoked session is sent back to the login page even with permissions", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ sessionInvalid: true })),
    { type: "redirect", to: ADMIN_LOGIN_PATH },
  );
  // Revocation outranks ADMIN too.
  assert.deepEqual(
    decideAdminRouteAccess(admin({ sessionInvalid: true })),
    { type: "redirect", to: ADMIN_LOGIN_PATH },
  );
});

// ── Forced password change ──────────────────────────────────────────────────

test("a pending password change blocks every other admin page", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ mustChangePassword: true })),
    { type: "redirect", to: ADMIN_CHANGE_PASSWORD_PATH },
  );
  assert.deepEqual(
    decideAdminRouteAccess(admin({ mustChangePassword: true })),
    { type: "redirect", to: ADMIN_CHANGE_PASSWORD_PATH },
  );
});

test("the change-password page itself remains reachable during that block", () => {
  assert.deepEqual(
    decideAdminRouteAccess(
      staff({ pathname: ADMIN_CHANGE_PASSWORD_PATH, mustChangePassword: true }),
    ),
    { type: "allow" },
  );
});

// ── Permission checks ───────────────────────────────────────────────────────

test("a staff user reaches a page their role grants", () => {
  assert.deepEqual(decideAdminRouteAccess(staff()), { type: "allow" });
});

test("customer advance routes use the matching view permission", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({
      pathname: "/admin/customer-advances",
      permissions: ["customer_advances.view"],
    })),
    { type: "allow" },
  );
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: "/admin/customer-advances", permissions: [] })),
    { type: "deny" },
  );
});

test("a staff user is denied a page their role does not grant", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: "/admin/audit-log" })),
    { type: "deny" },
  );
});

test("a rule with a null permission is open to any role holder", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: "/admin/notifications", permissions: [] })),
    { type: "allow" },
  );
});

// The single most important fail-closed case: a menu added without registering
// it in ADMIN_ROUTE_RULES must be denied, not left open.
test("an admin path with no matching rule fails closed for staff", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: "/admin/some-unregistered-menu" })),
    { type: "deny" },
  );
});

test("a signed-in user with no app role and no ADMIN is denied", () => {
  assert.deepEqual(
    decideAdminRouteAccess({
      ...signedOut,
      pathname: "/admin/products",
      isLoggedIn: true,
      permissions: ["products.view"],
    }),
    { type: "deny" },
  );
});

// ── ADMIN bypass and its knowledge.* exception ──────────────────────────────

test("ADMIN bypasses permission checks on ordinary admin pages", () => {
  assert.deepEqual(decideAdminRouteAccess(admin()), { type: "allow" });
  assert.deepEqual(
    decideAdminRouteAccess(admin({ pathname: "/admin/audit-log" })),
    { type: "allow" },
  );
  assert.deepEqual(
    decideAdminRouteAccess(admin({ pathname: "/admin/some-unregistered-menu" })),
    { type: "allow" },
  );
});

// knowledge.* stays grant-only: being ADMIN is not enough, the permission has
// to be present on the session.
test("ADMIN still needs an explicit grant for knowledge routes", () => {
  assert.deepEqual(
    decideAdminRouteAccess(admin({ pathname: "/admin/knowledge", permissions: [] })),
    { type: "deny" },
  );
  assert.deepEqual(
    decideAdminRouteAccess(
      admin({ pathname: "/admin/knowledge", permissions: ["knowledge.view"] }),
    ),
    { type: "allow" },
  );
});

test("a staff user needs the same explicit grant for knowledge routes", () => {
  assert.deepEqual(
    decideAdminRouteAccess(staff({ pathname: "/admin/knowledge", permissions: [] })),
    { type: "deny" },
  );
  assert.deepEqual(
    decideAdminRouteAccess(
      staff({ pathname: "/admin/knowledge", permissions: ["knowledge.view"] }),
    ),
    { type: "allow" },
  );
});

// ── Ordering invariants ─────────────────────────────────────────────────────

// These pin the precedence the inline callback encoded by statement order, so
// reordering the checks during a refactor shows up as a failure rather than a
// subtle hole.
test("sign-in outranks the password change, which outranks permissions", () => {
  // Not signed in + must change password → login wins.
  assert.deepEqual(
    decideAdminRouteAccess({
      ...signedOut,
      mustChangePassword: true,
      pathname: "/admin/audit-log",
    }),
    { type: "redirect", to: ADMIN_LOGIN_PATH },
  );
  // Signed in, must change password, and lacks the permission → password wins,
  // so the user is never told whether they had access.
  assert.deepEqual(
    decideAdminRouteAccess(staff({ mustChangePassword: true, pathname: "/admin/audit-log" })),
    { type: "redirect", to: ADMIN_CHANGE_PASSWORD_PATH },
  );
});
