import test from "node:test";
import assert from "node:assert/strict";

import { LineMessageType } from "@/lib/generated/prisma";
import { normalizeLineWebhookEvents } from "@/lib/line-webhook-events";

test("normalizes text events with reply token", () => {
  const [event] = normalizeLineWebhookEvents({
    events: [
      {
        type: "message",
        webhookEventId: "event-1",
        replyToken: "reply-1",
        source: { type: "user", userId: "line-user-1" },
        message: { id: "message-1", type: "text", text: "  คอมแอร์ vios  " },
      },
    ],
  });

  assert.equal(event.lineEventId, "event-1");
  assert.equal(event.replyToken, "reply-1");
  assert.equal(event.lineUserId, "line-user-1");
  assert.equal(event.messageType, LineMessageType.TEXT);
  assert.equal(event.lineMessageId, "message-1");
  assert.equal(event.text, "คอมแอร์ vios");
  assert.equal(event.canReply, true);
});

test("normalizes image events without treating them as text", () => {
  const [event] = normalizeLineWebhookEvents({
    events: [
      {
        type: "message",
        webhookEventId: "event-2",
        replyToken: "reply-2",
        source: { type: "user", userId: "line-user-2" },
        message: { id: "message-2", type: "image" },
      },
    ],
  });

  assert.equal(event.messageType, LineMessageType.IMAGE);
  assert.equal(event.text, null);
  assert.equal(event.canReply, true);
});

test("drops events without source", () => {
  assert.deepEqual(
    normalizeLineWebhookEvents({
      events: [{ type: "message", webhookEventId: "event-3", message: { type: "text", text: "hello" } }],
    }),
    [],
  );
});

test("keeps unsupported message types as unknown", () => {
  const [event] = normalizeLineWebhookEvents({
    events: [
      {
        type: "message",
        source: { type: "user", userId: "line-user-3" },
        message: { id: "message-3", type: "video" },
      },
    ],
  });

  assert.equal(event.lineEventId, "message-3");
  assert.equal(event.messageType, LineMessageType.UNKNOWN);
  assert.equal(event.canReply, false);
});
