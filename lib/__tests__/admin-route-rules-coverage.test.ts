import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ADMIN_ROUTE_RULES, getRoutePermission } from "@/lib/access-control";
import { decideAdminRouteAccess } from "@/lib/admin-route-access";

// ADMIN_ROUTE_RULES used to end with a catch-all { prefix: "/admin" } that made
// every unregistered admin path resolve to workboard.view, so the fail-closed
// branch in decideAdminRouteAccess() could never run. The catch-all is gone;
// these tests pin that (1) every real admin route still resolves to exactly the
// permission it had before, and (2) an unregistered path is now really denied.

const appRoot = path.join(process.cwd(), "app");

const listAdminRouteFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name.startsWith("_") ? [] : listAdminRouteFiles(entryPath);
    }
    return /^(page|route)\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });

/** URL path for a route file: drop (groups), turn [param] into a sample segment. */
const toUrlPath = (filePath: string): string =>
  `/${path
    .relative(appRoot, path.dirname(filePath))
    .split(path.sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => (/^\[.*\]$/.test(segment) ? "sample-id" : segment))
    .join("/")}`;

/** The previous resolution: same rules plus the old trailing catch-all. */
const previousRoutePermission = (pathname: string) => {
  const current = getRoutePermission(pathname);
  if (current !== undefined) return current;
  return pathname.startsWith("/admin") ? "workboard.view" : undefined;
};

test("the catch-all /admin prefix rule is gone", () => {
  assert.equal(
    ADMIN_ROUTE_RULES.some((rule) => rule.prefix === "/admin"),
    false,
  );
});

test("every existing admin page and route handler resolves to the same permission as before", () => {
  const routes = listAdminRouteFiles(path.join(appRoot, "admin")).map(toUrlPath);
  assert.ok(routes.length > 100, `expected the full admin tree, got ${routes.length}`);

  const changed = routes
    // /admin/login is decided before any permission lookup.
    .filter((route) => route !== "/admin/login")
    .filter((route) => getRoutePermission(route) === undefined)
    .map((route) => `${route} (was ${String(previousRoutePermission(route))})`);
  assert.deepEqual(changed, []);
  assert.equal(getRoutePermission("/admin"), "workboard.view");
});

test("an unregistered admin path is denied even for staff holding workboard.view", () => {
  const staff = {
    isLoggedIn: true,
    isAdmin: false,
    hasAppRole: true,
    mustChangePassword: false,
    sessionInvalid: false,
    permissions: ["workboard.view", "products.view"],
  };
  assert.deepEqual(decideAdminRouteAccess({ ...staff, pathname: "/admin/some-unregistered-menu" }), {
    type: "deny",
  });
  assert.deepEqual(decideAdminRouteAccess({ ...staff, pathname: "/admin" }), { type: "allow" });
  assert.deepEqual(decideAdminRouteAccess({ ...staff, pathname: "/admin/workboard" }), { type: "allow" });
  assert.deepEqual(decideAdminRouteAccess({ ...staff, pathname: "/admin", permissions: ["products.view"] }), {
    type: "deny",
  });
});
