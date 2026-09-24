import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { NextRequest, type NextFetchEvent } from "next/server";
import { encode } from "next-auth/jwt";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

/**
 * Drives the real proxy (proxy.ts) and the real Auth.js wrapper with a real,
 * encrypted session cookie. Only the database is faked.
 *
 * - public paths never run auth(): no DB revocation read, no Set-Cookie
 * - /admin paths do, and authorized() now blocks a denied permission with 403
 * - the root POST guard still answers first
 * - the legacy Thai product redirect still points at the NEXTAUTH_URL origin
 */

const SITE = "https://www.sriwanparts.com";
const SECRET = "proxy-auth-gate-test-secret-0123456789abcdef";
const COOKIE_NAME = "__Secure-authjs.session-token";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

process.env.AUTH_SECRET = SECRET;
process.env.NEXTAUTH_URL = SITE;

type FakeUser = { authVersion: number; isActive: boolean };
const users = new Map<string, FakeUser>();
let userLookups = 0;

const db = {
  user: {
    findUnique: async (args: { where: { id: string } }): Promise<FakeUser | null> => {
      userLookups += 1;
      return users.get(args.where.id) ?? null;
    },
  },
  product: {
    findFirst: async (args: { where: { id: string } }) =>
      args.where.id === "abc123"
        ? {
            id: "abc123",
            slug: "brake-pad",
            name: "Brake pad",
            code: "BP-1",
            category: { id: "c1", name: "Brakes", slug: "brakes" },
          }
        : null,
  },
};

type TokenInput = {
  id: string;
  role: "ADMIN" | "STAFF";
  appRoleId?: string | null;
  permissions?: string[];
  mustChangePassword?: boolean;
};

async function sessionCookie(input: TokenInput): Promise<string> {
  const token = await encode({
    secret: SECRET,
    salt: COOKIE_NAME,
    token: {
      sub: input.id,
      id: input.id,
      name: input.id,
      role: input.role,
      appRoleId: input.appRoleId ?? null,
      permissions: input.permissions ?? [],
      mustChangePassword: input.mustChangePassword ?? false,
      authVersion: 1,
      sessionInvalid: false,
    },
  });
  return `${COOKIE_NAME}=${token}`;
}

async function callProxy(
  url: string,
  init: { method?: string; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { proxy } = await import("@/proxy");
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  const request = new NextRequest(url, { method: init.method ?? "GET", headers });
  // next/server exports NextFetchEvent as a type only; the proxy never uses it.
  const event = { sourcePage: "/", waitUntil: () => undefined } as unknown as NextFetchEvent;
  const response = await proxy(request, event);
  assert.ok(response instanceof Response, "proxy must answer every request");
  return response;
}

const continues = (response: Response): boolean => response.headers.get("x-middleware-next") === "1";

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db,
      withDbRetry: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
      isTransientDbError: () => false,
      dbTx: () => {
        throw new Error("not used");
      },
      dbSearchRaw: async () => {
        throw new Error("not used");
      },
      dbSearchTx: async () => {
        throw new Error("not used");
      },
    },
  });
});

beforeEach(async () => {
  if (moduleMocksUnavailable) return;
  const { clearRevocationCache } = await import("@/lib/auth-revocation-cache");
  clearRevocationCache();
  users.clear();
  userLookups = 0;
  users.set("staff-sales", { authVersion: 1, isActive: true });
  users.set("staff-no-role", { authVersion: 1, isActive: true });
  users.set("owner", { authVersion: 1, isActive: true });
});

const salesStaff = (): Promise<string> =>
  sessionCookie({ id: "staff-sales", role: "STAFF", appRoleId: "role-sales", permissions: ["workboard.view", "sales.view"] });

test("public pages and images never run auth(): no DB lookup, no refreshed session cookie", { skip: moduleMocksUnavailable }, async () => {
  const cookie = await salesStaff();
  for (const path of ["/", "/products", "/_next/image?url=%2Fa.png&w=64&q=75", "/contact"]) {
    const response = await callProxy(`${SITE}${path}`, { cookie });
    assert.ok(continues(response), path);
    assert.equal(response.headers.get("set-cookie"), null, path);
  }
  assert.equal(userLookups, 0);
});

test("/admin paths still run auth(): revocation lookup, sliding 7-day cookie, request continues", { skip: moduleMocksUnavailable }, async () => {
  const before = Date.now();
  const response = await callProxy(`${SITE}/admin/workboard`, { cookie: await salesStaff() });
  assert.ok(continues(response));
  assert.equal(userLookups, 1);

  const setCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`)) ?? "";
  assert.ok(setCookie, "the session cookie is re-issued on admin requests");
  const expires = Date.parse(/Expires=([^;]+)/i.exec(setCookie)?.[1] ?? "");
  assert.ok(Math.abs(expires - (before + SEVEN_DAYS_MS)) < 60_000, `cookie expiry ${new Date(expires).toISOString()}`);
});

test("a second admin request within 30s reuses the revocation lookup", { skip: moduleMocksUnavailable }, async () => {
  const cookie = await salesStaff();
  await callProxy(`${SITE}/admin/workboard`, { cookie });
  await callProxy(`${SITE}/admin/sales`, { cookie });
  assert.equal(userLookups, 1);
});

test("signed-out admin requests are still sent to the login page", { skip: moduleMocksUnavailable }, async () => {
  const response = await callProxy(`${SITE}/admin/sales`);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${SITE}/admin/login`);
});

test("a pending password change still redirects to the change-password page", { skip: moduleMocksUnavailable }, async () => {
  const cookie = await sessionCookie({
    id: "staff-sales",
    role: "STAFF",
    appRoleId: "role-sales",
    permissions: ["sales.view"],
    mustChangePassword: true,
  });
  const response = await callProxy(`${SITE}/admin/sales`, { cookie });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${SITE}/admin/profile/change-password`);
});

test("a denied permission is now blocked with 403: HTML for a page load, JSON otherwise", { skip: moduleMocksUnavailable }, async () => {
  const cookie = await salesStaff();

  const page = await callProxy(`${SITE}/admin/audit-log`, { cookie, headers: { "sec-fetch-dest": "document", accept: "text/html" } });
  assert.equal(page.status, 403);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(page.headers.get("cache-control"), "private, no-store");
  assert.ok(!continues(page));

  const nonDocumentRequests: Record<string, string>[] = [
    { rsc: "1" },
    { rsc: "1", "next-router-prefetch": "1" },
    { "next-action": "abc", accept: "text/x-component" },
  ];
  for (const headers of nonDocumentRequests) {
    const response = await callProxy(`${SITE}/admin/audit-log`, { cookie, headers, method: "next-action" in headers ? "POST" : "GET" });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { error: "FORBIDDEN" });
    assert.equal(response.headers.get("location"), null);
  }
});

test("staff without an app role and admins without a knowledge grant are blocked", { skip: moduleMocksUnavailable }, async () => {
  const noRole = await sessionCookie({ id: "staff-no-role", role: "STAFF", permissions: [] });
  assert.equal((await callProxy(`${SITE}/admin/workboard`, { cookie: noRole })).status, 403);

  const owner = await sessionCookie({ id: "owner", role: "ADMIN", permissions: ["audit_log.view"] });
  assert.equal((await callProxy(`${SITE}/admin/knowledge`, { cookie: owner })).status, 403);
  assert.ok(continues(await callProxy(`${SITE}/admin/audit-log`, { cookie: owner })));
});

test("users holding the page's own permission still get through", { skip: moduleMocksUnavailable }, async () => {
  const marketplaceOperator = await sessionCookie({
    id: "staff-sales",
    role: "STAFF",
    appRoleId: "role-marketplace",
    permissions: ["marketplace.manage"],
  });
  assert.ok(continues(await callProxy(`${SITE}/admin/sales/shopee/settlements`, { cookie: marketplaceOperator })));
  assert.ok(continues(await callProxy(`${SITE}/admin/sales`, { cookie: await salesStaff() })));
});

test("a disabled user is rejected once the 30s memo expires", { skip: moduleMocksUnavailable }, async () => {
  const cookie = await salesStaff();
  assert.ok(continues(await callProxy(`${SITE}/admin/sales`, { cookie })));

  users.set("staff-sales", { authVersion: 1, isActive: false });
  const { clearRevocationCache } = await import("@/lib/auth-revocation-cache");
  clearRevocationCache(); // stands in for the 30s TTL; the TTL itself is unit-tested
  const response = await callProxy(`${SITE}/admin/sales`, { cookie });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${SITE}/admin/login`);
});

test("POST / is still rejected first, without touching auth", { skip: moduleMocksUnavailable }, async () => {
  const response = await callProxy(`${SITE}/`, { method: "POST", cookie: await salesStaff() });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(userLookups, 0);
});

test("the legacy Thai product redirect still targets the NEXTAUTH_URL origin", { skip: moduleMocksUnavailable }, async () => {
  // "ยาง-abc123" percent-encoded, requested through a non-canonical host.
  const legacyPath = "/product/%E0%B8%A2%E0%B8%B2%E0%B8%87-abc123";
  const response = await callProxy(`https://preview-deploy.vercel.app${legacyPath}`);
  assert.equal(response.status, 308);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.origin, SITE);
  assert.match(location.pathname, /^\/product\/[a-z0-9-]+-abc123$/);
});
