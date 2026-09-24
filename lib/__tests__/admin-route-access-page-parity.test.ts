import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolveAdminRoutePermission } from "@/lib/admin-route-access";

// The proxy now enforces a "deny" from decideAdminRouteAccess() (it used to be
// ignored). That is only safe while the route gate never asks for a permission
// the page itself does not ask for — otherwise a user the page accepts would be
// turned away at the gate. This test reads every admin page / route handler
// (or, for a page that delegates, the local components it renders) and checks
// the gate's key is one the page requires too.

const appRoot = path.join(process.cwd(), "app");

const listAdminRouteFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name.startsWith("_") ? [] : listAdminRouteFiles(entryPath);
    }
    return /^(page|route)\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });

const toUrlPath = (filePath: string): string =>
  `/${path
    .relative(appRoot, path.dirname(filePath))
    .split(path.sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => (/^\[.*\]$/.test(segment) ? "sample-id" : segment))
    .join("/")}`;

/**
 * Relative modules a route file imports (one level deep), minus Server Action
 * files: their per-action checks say nothing about who may open the page.
 */
const readLocalImports = (filePath: string, source: string): string =>
  [...source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)]
    .map((match) => path.resolve(path.dirname(filePath), match[1]))
    .filter((base) => path.basename(base) !== "actions")
    .flatMap((base) => [`${base}.tsx`, `${base}.ts`].filter((candidate) => existsSync(candidate)))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

/** Keys the page unconditionally requires (a `.catch()`-ed check is optional). */
const requiredKeys = (source: string): string[] =>
  [...source.matchAll(/requirePermission\(\s*"([^"]+)"\s*\)(?!\s*\.catch)/g)].map((match) => match[1]);

// Pages that only redirect, or are open to any signed-in role holder.
const PAGES_WITHOUT_OWN_KEY = new Set([
  "/admin",
  "/admin/lots",
  "/admin/login",
  "/admin/notifications",
  "/admin/profile/change-password",
]);

test("the route gate never requires a permission the page itself does not require", () => {
  const files = listAdminRouteFiles(path.join(appRoot, "admin"));
  assert.ok(files.length > 100, `expected the full admin tree, got ${files.length}`);

  const mismatches: string[] = [];
  const withoutKey: string[] = [];

  for (const file of files) {
    const route = toUrlPath(file);
    const source = readFileSync(file, "utf8");
    const gate = resolveAdminRoutePermission(route);
    if (/requireAnyPermission\(/.test(source) && gate !== null) {
      mismatches.push(`${route}: page accepts any of several keys, gate requires ${String(gate)}`);
      continue;
    }
    // The page's own checks decide; delegating pages (e.g. the marketplace
    // sale screens) keep theirs in the component they render.
    const ownKeys = requiredKeys(source);
    const keys = ownKeys.length > 0 ? ownKeys : requiredKeys(readLocalImports(file, source));
    if (keys.length === 0) {
      if (!PAGES_WITHOUT_OWN_KEY.has(route)) withoutKey.push(route);
      continue;
    }
    if (gate !== null && !keys.includes(String(gate))) {
      mismatches.push(`${route}: gate requires ${String(gate)}, page requires ${keys.join(" + ")}`);
    }
  }

  assert.deepEqual(mismatches, []);
  assert.deepEqual(withoutKey, [], "new admin route without a readable requirePermission(); check it by hand");
});

test("overridden marketplace / WHT / knowledge routes use a key their page requires", () => {
  assert.equal(resolveAdminRoutePermission("/admin/sales/shopee/settlements"), "marketplace.manage");
  assert.equal(resolveAdminRoutePermission("/admin/sales/lazada/new"), "sales.create");
  assert.equal(resolveAdminRoutePermission("/admin/sales/shopee/returns/new"), "credit_notes.create");
  assert.equal(resolveAdminRoutePermission("/admin/marketplace/settlements/abc"), "marketplace.manage");
  assert.equal(resolveAdminRoutePermission("/admin/wht/certificates/new"), "wht.create");
  assert.equal(resolveAdminRoutePermission("/admin/wht/filings/new"), "wht_filings.manage");
  assert.equal(resolveAdminRoutePermission("/admin/knowledge/test"), "knowledge.sync");
  // Everything else still comes from getRoutePermission().
  assert.equal(resolveAdminRoutePermission("/admin/sales/abc123"), "sales.view");
  assert.equal(resolveAdminRoutePermission("/admin/marketplace/shopee"), "marketplace.view");
});
