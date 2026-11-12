import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { NextRequest } from "next/server";

// C9 (2026-11-12): the admin chat poller asks for `latestOnly=1`, which returns
// only the newest message id from one query. It must pick the same message the
// previous `take=1` full read returned as messages.at(-1), behind the same
// permission check, and the full read must stay unchanged.

type Call = { model: string; method: string; args: unknown };

const calls: Call[] = [];
const permissionChecks: string[] = [];
let permissionError: Error | null = null;
let conversationExists = true;
const newestMessage = { id: "msg-newest" };

const record =
  <R>(model: string, method: string, result: () => R) =>
  async (args: unknown): Promise<R> => {
    calls.push({ model, method, args });
    return result();
  };

let GET: typeof import("../route").GET;

before(async () => {
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async (permission: string): Promise<{ user: { id: string } }> => {
        permissionChecks.push(permission);
        if (permissionError) throw permissionError;
        return { user: { id: "admin-1" } };
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        lineConversation: {
          findUnique: record("lineConversation", "findUnique", () =>
            conversationExists
              ? {
                  id: "conv-1",
                  lineUserId: "U1",
                  displayName: "ลูกค้า",
                  aiStatus: "ACTIVE",
                  pausedReason: null,
                  customer: { id: "cust-1", name: "ลูกค้า", phone: null },
                  assignedAdmin: null,
                }
              : null,
          ),
        },
        customer: { findUnique: record("customer", "findUnique", () => null) },
        lineMessage: {
          findMany: record("lineMessage", "findMany", () => (conversationExists ? [{ ...newestMessage, text: "สวัสดี" }] : [])),
          findFirst: record("lineMessage", "findFirst", () => (conversationExists ? { ...newestMessage } : null)),
        },
      },
    },
  });
  GET = (await import("../route")).GET;
});

beforeEach(() => {
  calls.length = 0;
  permissionChecks.length = 0;
  permissionError = null;
  conversationExists = true;
});

const request = (query: string): NextRequest =>
  new NextRequest(`https://www.sriwanparts.com/api/admin/line-conversations/conv-1/messages?${query}`);
const params = { params: Promise.resolve({ id: "conv-1" }) };

const messageQuery = (call: Call | undefined): unknown => {
  const args = call?.args as { where: unknown; orderBy: unknown; take?: number } | undefined;
  return { where: args?.where, orderBy: args?.orderBy, take: args?.take ?? 1 };
};

test("latestOnly returns the same newest id as the previous take=1 read, from one query", async () => {
  const oldResponse = await GET(request("take=1"), params);
  const oldPayload = (await oldResponse.json()) as { messages: Array<{ id: string }> };
  const oldCalls = [...calls];

  calls.length = 0;
  const newResponse = await GET(request("take=1&latestOnly=1"), params);
  const newPayload = (await newResponse.json()) as { latestMessageId: string | null };

  assert.equal(newResponse.status, 200);
  assert.equal(newPayload.latestMessageId, oldPayload.messages.at(-1)?.id);
  assert.equal(newResponse.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(
    calls.map((call) => `${call.model}.${call.method}`),
    ["lineMessage.findFirst"],
  );
  assert.deepEqual(calls[0]?.args, {
    where: { conversationId: "conv-1" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  // Same row selection as the old message read: same filter, same order, one row.
  const oldMessageRead = oldCalls.find((call) => call.model === "lineMessage");
  assert.deepEqual(messageQuery(calls[0]), messageQuery(oldMessageRead));
  assert.deepEqual(permissionChecks, ["line_conversations.view", "line_conversations.view"]);
});

test("an unknown conversation gives no id, so the poller does not refresh (as with the old 404)", async () => {
  conversationExists = false;
  const oldResponse = await GET(request("take=1"), params);
  assert.equal(oldResponse.status, 404);

  const newResponse = await GET(request("take=1&latestOnly=1"), params);
  assert.deepEqual(await newResponse.json(), { latestMessageId: null });
});

test("latestOnly keeps the permission check and its error responses", async () => {
  for (const [message, status] of [
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
  ] as const) {
    permissionError = new Error(message);
    const oldResponse = await GET(request("take=1"), params);
    const newResponse = await GET(request("take=1&latestOnly=1"), params);
    assert.equal(newResponse.status, status);
    assert.equal(oldResponse.status, status);
    assert.deepEqual(await newResponse.json(), await oldResponse.json());
  }
  assert.equal(calls.length, 0);
});

test("the full read without latestOnly is unchanged", async () => {
  const response = await GET(request("take=1"), params);
  const payload = (await response.json()) as { conversation: { id: string }; messages: Array<{ id: string }> };

  assert.equal(payload.conversation.id, "conv-1");
  assert.deepEqual(payload.messages, [{ id: "msg-newest", text: "สวัสดี" }]);
  assert.deepEqual(
    calls.map((call) => `${call.model}.${call.method}`),
    ["lineConversation.findUnique", "lineMessage.findMany"],
  );
});
