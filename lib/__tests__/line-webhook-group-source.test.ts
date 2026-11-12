import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { before, beforeEach, mock } from "node:test";

import type {
  LineWebhookProcessorConfig,
  LineWebhookProcessorDependencies,
} from "@/lib/line-webhook-processor";

// C6: a message typed inside a LINE group or room carries the sender's userId, but the bot must
// stay silent there — no LineConversation / LineMessage write, no AI, no Telegram mirror, no reply
// into the group — in BOTH the coalesced and legacy loops. The webhook route still registers the
// group / room (and the sender) as LINE recipients exactly as before (daily summary). A 1:1 chat
// (`source.type = "user"`) still enters the pipeline.

const CHANNEL_SECRET = "test-channel-secret";
const CHANNEL_ACCESS_TOKEN = "test-channel-token";
process.env.LINE_MESSAGING_API_CHANNEL_SECRET = CHANNEL_SECRET;
process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN = CHANNEL_ACCESS_TOKEN;

const LINE_PROFILE_URL_PREFIX = "https://api.line.me/v2/bot/profile/";

const groupSource = { type: "group", groupId: "C-group-1", userId: "U-staff-1" };
const roomSource = { type: "room", roomId: "R-room-1", userId: "U-staff-2" };
const userSource = { type: "user", userId: "U-customer-1" };

const eventsFrom = (source: Record<string, string>, prefix: string) => [
  {
    type: "message",
    webhookEventId: `${prefix}-text`,
    replyToken: `${prefix}-rt-text`,
    source,
    message: { id: `${prefix}-m1`, type: "text", text: "หม้อน้ำ vios ราคาเท่าไหร่" },
  },
  {
    type: "message",
    webhookEventId: `${prefix}-image`,
    replyToken: `${prefix}-rt-image`,
    source,
    message: { id: `${prefix}-m2`, type: "image" },
  },
  {
    type: "message",
    webhookEventId: `${prefix}-sticker`,
    replyToken: `${prefix}-rt-sticker`,
    source,
    message: { id: `${prefix}-m3`, type: "sticker" },
  },
  { type: "postback", webhookEventId: `${prefix}-postback`, replyToken: `${prefix}-rt-postback`, source, postback: { data: "a=1" } },
];

const groupEvents = eventsFrom(groupSource, "group");
const roomEvents = eventsFrom(roomSource, "room");
const userTextEvent = {
  type: "message",
  webhookEventId: "user-text",
  replyToken: "user-rt-text",
  source: userSource,
  message: { id: "user-m1", type: "text", text: "หม้อน้ำ vios" },
};

// ── recorders ────────────────────────────────────────────────────────────────

type DbCall = { call: string; args: unknown };
const dbCalls: DbCall[] = [];
const telegramMirrors: unknown[] = [];
const criticalReports: unknown[] = [];
const forbiddenFetches: string[] = [];
const profileFetches: string[] = [];
const afterTasks: Array<Promise<unknown> | (() => unknown)> = [];

/** Any Prisma call is recorded; only the reads / writes the route already did before C6 answer. */
const recordingDb = new Proxy({} as Record<string, unknown>, {
  get(_target, model: string) {
    if (model === "then") return undefined;
    return new Proxy({} as Record<string, unknown>, {
      get(_inner, method: string) {
        if (method === "then") return undefined;
        return async (args: unknown) => {
          const call = `${model}.${method}`;
          dbCalls.push({ call, args });
          if (call === "lineRecipient.upsert") return { id: `recipient-${dbCalls.length}` };
          if (call === "lineConversation.findUnique") return null;
          if (call === "siteContent.findMany") return [];
          throw new Error(`unexpected db call ${call}`);
        };
      },
    });
  },
});

before(async () => {
  const realDb = await import("@/lib/db");
  const realNextServer = await import("next/server");
  const realTelegram = await import("@/lib/telegram");
  const realErrorReporting = await import("@/lib/error-reporting");
  mock.module("@/lib/db", { namedExports: { ...realDb, db: recordingDb } });
  mock.module("next/server", {
    namedExports: { ...realNextServer, after: (task: Promise<unknown> | (() => unknown)) => { afterTasks.push(task); } },
  });
  mock.module("@/lib/telegram", {
    namedExports: {
      ...realTelegram,
      mirrorLineMessageToTelegram: async (params: unknown) => {
        telegramMirrors.push(params);
        return { sentCount: 1 };
      },
    },
  });
  mock.module("@/lib/error-reporting", {
    namedExports: {
      ...realErrorReporting,
      reportCriticalError: async (error: unknown) => {
        criticalReports.push(error);
      },
    },
  });
  // LINE reply / push / loading dots, Gemini and Telegram all go over fetch: only the profile
  // lookup the route already made before C6 may run.
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(LINE_PROFILE_URL_PREFIX)) {
      profileFetches.push(url.slice(LINE_PROFILE_URL_PREFIX.length));
      return Response.json({ displayName: "พนักงานร้าน" });
    }
    forbiddenFetches.push(url);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

beforeEach(() => {
  dbCalls.length = 0;
  telegramMirrors.length = 0;
  criticalReports.length = 0;
  forbiddenFetches.length = 0;
  profileFetches.length = 0;
  afterTasks.length = 0;
});

/** Processor dependencies that throw on any use; the duplicate check answers "already processed"
 *  so a 1:1 event stops right after passing the filter. */
function createRecordingDependencies() {
  const called: string[] = [];
  const checkedEventIds: Array<string | null> = [];
  const dependencies = new Proxy({} as Record<string, unknown>, {
    get(_target, property: string) {
      if (property === "then") return undefined;
      return async (...args: unknown[]) => {
        called.push(property);
        if (property === "hasProcessedLineEvent") {
          checkedEventIds.push((args[0] as string | null) ?? null);
          return true;
        }
        throw new Error(`dependency ${property} must not run in this test`);
      };
    },
  }) as unknown as LineWebhookProcessorDependencies;
  return { called, checkedEventIds, dependencies };
}

const processorConfig = (coalesce: boolean): LineWebhookProcessorConfig => ({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  autoReplyEnabled: true,
  dryRun: false,
  imageSearchEnabled: true,
  allowPushFallback: true,
  receivedAt: new Date(),
  replyTokenMaxAgeMs: 55_000,
  coalesce,
  coalesceWindowMs: 0,
});

test("isLineGroupOrRoomEvent: group and room are not 1:1 chats; user (and a source without type) is", async () => {
  const { isLineGroupOrRoomEvent, normalizeLineWebhookEvents } = await import("@/lib/line-webhook-events");
  const normalized = normalizeLineWebhookEvents({
    events: [
      groupEvents[0],
      roomEvents[0],
      userTextEvent,
      { ...userTextEvent, webhookEventId: "no-type", source: { userId: "U-legacy" } },
    ],
  });
  assert.deepEqual(
    normalized.map((event) => [event.sourceType, isLineGroupOrRoomEvent(event)]),
    [
      ["group", true],
      ["room", true],
      ["user", false],
      [null, false],
    ],
  );
});

for (const coalesce of [true, false]) {
  const mode = coalesce ? "coalesced" : "legacy";

  for (const [label, events] of [["group", groupEvents], ["room", roomEvents]] as const) {
    test(`${mode} loop: ${label} messages are skipped before any ingest, AI, Telegram or reply`, async () => {
      const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
      const { called, dependencies } = createRecordingDependencies();

      const result = await processLineWebhookPayload({ events }, processorConfig(coalesce), dependencies);

      assert.deepEqual(result, { processedCount: 0, duplicateCount: 0, skippedCount: events.length, repliedCount: 0 });
      // No duplicate lookup, no conversation, no INBOUND row, no AI job, no reply / push, no dots.
      assert.deepEqual(called, []);
      assert.deepEqual(telegramMirrors, []);
      assert.deepEqual(forbiddenFetches, []);
      assert.deepEqual(dbCalls, []);
    });
  }

  test(`${mode} loop: a 1:1 user message in the same payload still enters the pipeline`, async () => {
    const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
    const { checkedEventIds, dependencies } = createRecordingDependencies();

    const result = await processLineWebhookPayload(
      { events: [...groupEvents, userTextEvent, ...roomEvents] },
      processorConfig(coalesce),
      dependencies,
    );

    assert.deepEqual(checkedEventIds, ["user-text"]);
    assert.equal(result.skippedCount, groupEvents.length + roomEvents.length);
    assert.equal(result.duplicateCount, 1);
  });
}

async function postSignedWebhook(payload: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/line/webhook/route");
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64");
  const response = await POST(
    new Request("http://localhost/api/line/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": signature },
      body,
    }),
  );
  for (const task of afterTasks) await (typeof task === "function" ? task() : task);
  return response;
}

type RecipientUpsertArgs = { where: { lineId: string }; create: { type: string; sourceName: string } };

for (const [label, source, events, expectedType] of [
  ["group", groupSource, groupEvents, "GROUP"],
  ["room", roomSource, roomEvents, "ROOM"],
] as const) {
  test(`webhook route: a ${label} message still registers the ${label} recipient and nothing else runs`, async () => {
    const groupId = "groupId" in source ? source.groupId : source.roomId;
    const response = await postSignedWebhook({ events: [events[0]] });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, accepted: 1 });

    // Recipient upsert unchanged: the sender (USER) and the group / room, as before C6.
    const upserts = dbCalls
      .filter((entry) => entry.call === "lineRecipient.upsert")
      .map((entry) => entry.args as RecipientUpsertArgs)
      .map((args) => [args.where.lineId, args.create.type, args.create.sourceName])
      .sort();
    assert.deepEqual(upserts, [
      [groupId, expectedType, "message"],
      [source.userId, "USER", "message"],
    ].sort());
    assert.deepEqual(profileFetches, [source.userId]);

    // The only other DB reads are the ones the route already made (profile freshness + AI
    // settings); no LineConversation / LineMessage / LineAiJob write.
    assert.deepEqual(
      dbCalls.map((entry) => entry.call).sort(),
      ["lineConversation.findUnique", "lineRecipient.upsert", "lineRecipient.upsert", "siteContent.findMany"],
    );
    assert.deepEqual(telegramMirrors, []);
    assert.deepEqual(forbiddenFetches, [], "no reply, push, loading dots or Gemini call");
    assert.deepEqual(criticalReports, []);
  });
}
