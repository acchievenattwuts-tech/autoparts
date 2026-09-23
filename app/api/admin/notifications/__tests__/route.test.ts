import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// The bell feed is outside the proxy matcher, so the route itself must honour
// session revocation (sessionInvalid) exactly like getRequiredSession().

type FakeSession = { user: { id: string; sessionInvalid: boolean } } | null;

let session: FakeSession;
const calls: string[] = [];

before(async () => {
  await mock.module("@/lib/auth-session", {
    namedExports: { getSession: async () => session },
  });
  await mock.module("@/lib/notifications", {
    namedExports: {
      getUnreadNotificationCount: async (userId: string) => {
        calls.push(`count:${userId}`);
        return 3;
      },
      listNotifications: async (userId: string, options: { take: number }) => {
        calls.push(`list:${userId}:${options.take}`);
        return [];
      },
      markAllNotificationsRead: async (userId: string) => {
        calls.push(`markAll:${userId}`);
        return 2;
      },
      markNotificationRead: async (userId: string, id: string) => {
        calls.push(`mark:${userId}:${id}`);
      },
    },
  });
});

beforeEach(() => {
  session = { user: { id: "u1", sessionInvalid: false } };
  calls.length = 0;
});

const get = async (query: string) => {
  const { GET } = await import("../route");
  const response = await GET(new Request(`https://shop.test/api/admin/notifications${query}`));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const post = async (body: unknown) => {
  const { POST } = await import("../route");
  const response = await POST(
    new Request("https://shop.test/api/admin/notifications", { method: "POST", body: JSON.stringify(body) }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

test("a revoked session is rejected for both read and mark-read", async () => {
  session = { user: { id: "u1", sessionInvalid: true } };
  assert.equal((await get("?mode=summary")).status, 401);
  assert.equal((await post({ action: "markAllRead" })).status, 401);
  session = null;
  assert.equal((await get("")).status, 401);
  assert.deepEqual(calls, []);
});

test("a valid session keeps the same responses as before", async () => {
  assert.deepEqual(await get(""), { status: 200, body: { unreadCount: 3 } });
  assert.deepEqual(await get("?mode=unknown"), { status: 200, body: { unreadCount: 3 } });
  assert.deepEqual(await get("?mode=list"), { status: 200, body: { items: [] } });
  await get("?mode=list&take=5");
  await get("?mode=list&take=abc");
  assert.deepEqual(await post({ action: "markAllRead" }), { status: 200, body: { ok: true, count: 2 } });
  assert.deepEqual(await post({ action: "markRead", id: "n1" }), { status: 200, body: { ok: true } });
  assert.deepEqual(calls, ["count:u1", "count:u1", "list:u1:10", "list:u1:5", "list:u1:10", "markAll:u1", "mark:u1:n1"]);
});

test("malformed POST bodies are still 400 INVALID_ACTION", async () => {
  for (const body of [null, {}, { action: "markRead" }, { action: "markRead", id: 5 }, { action: "delete" }]) {
    assert.deepEqual(await post(body), { status: 400, body: { error: "INVALID_ACTION" } });
  }
  assert.deepEqual(calls, []);
});
