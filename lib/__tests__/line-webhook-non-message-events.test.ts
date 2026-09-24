import assert from "node:assert/strict";
import test from "node:test";

import type {
  LineWebhookProcessorConfig,
  LineWebhookProcessorDependencies,
} from "@/lib/line-webhook-processor";

// Non-message LINE events (unsend, unfollow, memberLeft, …) carry no customer
// message. They must be skipped before ingest in BOTH the coalesced and legacy
// loops: no INBOUND row, no seq bump, no typing dots, no AI/admin handoff.
// message / follow / postback still enter the pipeline exactly as before.

const source = { type: "user", userId: "u1" };

const nonMessageEvents = [
  { type: "unsend", webhookEventId: "ev-unsend", source, unsend: { messageId: "m-old" } },
  { type: "unfollow", webhookEventId: "ev-unfollow", source },
  { type: "memberLeft", webhookEventId: "ev-member-left", source },
  { type: "videoPlayComplete", webhookEventId: "ev-video", replyToken: "rt-video", source },
];

const pipelineEvents = [
  {
    type: "message",
    webhookEventId: "ev-text",
    replyToken: "rt-text",
    source,
    message: { id: "m1", type: "text", text: "หม้อน้ำ vios" },
  },
  // A message type we do not parse (e.g. location) is still a customer message.
  {
    type: "message",
    webhookEventId: "ev-location",
    replyToken: "rt-location",
    source,
    message: { id: "m2", type: "location" },
  },
  { type: "follow", webhookEventId: "ev-follow", replyToken: "rt-follow", source },
  { type: "postback", webhookEventId: "ev-postback", replyToken: "rt-postback", source, postback: { data: "a=1" } },
];

/** Records every dependency touched; the duplicate check reports "already processed"
 *  so pipeline events stop right after passing the new filter. */
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

const config = (coalesce: boolean): LineWebhookProcessorConfig => ({
  channelAccessToken: "token",
  autoReplyEnabled: true,
  dryRun: false,
  imageSearchEnabled: true,
  allowPushFallback: false,
  receivedAt: new Date(),
  replyTokenMaxAgeMs: 45_000,
  coalesce,
  coalesceWindowMs: 0,
});

test("isLinePipelineEvent keeps message/follow/postback only", async () => {
  const { isLinePipelineEvent, normalizeLineWebhookEvents } = await import("@/lib/line-webhook-events");
  const normalized = normalizeLineWebhookEvents({ events: [...nonMessageEvents, ...pipelineEvents] });

  assert.deepEqual(
    normalized.map((event) => [event.eventType, isLinePipelineEvent(event)]),
    [
      ["unsend", false],
      ["unfollow", false],
      ["memberLeft", false],
      ["videoPlayComplete", false],
      ["message", true],
      ["message", true],
      ["follow", true],
      ["postback", true],
    ],
  );
});

for (const coalesce of [true, false]) {
  const mode = coalesce ? "coalesced" : "legacy";

  test(`${mode} loop: non-message events are skipped before any ingest work`, async () => {
    const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
    const { called, dependencies } = createRecordingDependencies();

    const result = await processLineWebhookPayload({ events: nonMessageEvents }, config(coalesce), dependencies);

    assert.deepEqual(result, { processedCount: 0, duplicateCount: 0, skippedCount: 4, repliedCount: 0 });
    // No duplicate lookup, no conversation, no INBOUND row, no seq bump, no loading dots.
    assert.deepEqual(called, []);
  });

  test(`${mode} loop: message / follow / postback still enter the pipeline`, async () => {
    const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
    const { checkedEventIds, dependencies } = createRecordingDependencies();

    const result = await processLineWebhookPayload(
      { events: [...nonMessageEvents, ...pipelineEvents] },
      config(coalesce),
      dependencies,
    );

    assert.deepEqual(checkedEventIds, ["ev-text", "ev-location", "ev-follow", "ev-postback"]);
    assert.equal(result.skippedCount, 4);
    assert.equal(result.duplicateCount, 4);
  });
}
