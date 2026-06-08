import test from "node:test";
import assert from "node:assert/strict";

import { LineConversationAiStatus } from "@/lib/generated/prisma";
import { buildLineConversationStatePatch } from "@/lib/line-conversation-service";

test("customer message only updates customer timestamp", () => {
  const at = new Date("2026-06-08T10:00:00.000Z");

  assert.deepEqual(buildLineConversationStatePatch({ type: "customer_message", at }), {
    lastCustomerMessageAt: at,
  });
});

test("admin message pauses AI and records admin ownership", () => {
  const at = new Date("2026-06-08T10:05:00.000Z");

  assert.deepEqual(
    buildLineConversationStatePatch({
      type: "admin_message",
      adminUserId: "user-1",
      at,
    }),
    {
      aiStatus: LineConversationAiStatus.PAUSED_BY_ADMIN,
      assignedAdminId: "user-1",
      lastAdminMessageAt: at,
      pausedAt: at,
      pausedReason: "ADMIN_REPLY",
    },
  );
});

test("resume clears pause reason and sets active status", () => {
  const at = new Date("2026-06-08T10:10:00.000Z");

  assert.deepEqual(buildLineConversationStatePatch({ type: "resume", at }), {
    aiStatus: LineConversationAiStatus.ACTIVE,
    resumedAt: at,
    pausedReason: null,
  });
});
