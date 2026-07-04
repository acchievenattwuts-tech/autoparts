import test from "node:test";
import assert from "node:assert/strict";

import { LineAiConfidence, LineConversationAiStatus, LineDeliveryMode, LineIntent } from "@/lib/generated/prisma";
import { resolveLineAiSendDecision } from "@/lib/line-ai-policy";
import type { LineIntentRouteResult } from "@/lib/chat-core/intent-router";

const productRoute: LineIntentRouteResult = {
  intent: LineIntent.PRODUCT_INQUIRY_TEXT,
  allowsSearch: true,
  requiresAdmin: false,
  requiresImageAnalysis: false,
  requiresMoreInfo: false,
  reason: "PRODUCT_HINT",
};

function decision(overrides: Partial<Parameters<typeof resolveLineAiSendDecision>[0]> = {}) {
  return resolveLineAiSendDecision({
    autoReplyEnabled: true,
    dryRun: false,
    conversationStatus: LineConversationAiStatus.ACTIVE,
    route: productRoute,
    confidence: LineAiConfidence.CONFIRMED,
    hasReplyToken: true,
    ...overrides,
  });
}

test("paused conversation blocks AI send", () => {
  assert.deepEqual(decision({ conversationStatus: LineConversationAiStatus.PAUSED_BY_ADMIN }), {
    action: "store_only",
    deliveryMode: LineDeliveryMode.NONE,
    reason: "CONVERSATION_PAUSED_BY_ADMIN",
  });
});

test("waiting-admin conversation blocks AI send", () => {
  assert.deepEqual(decision({ conversationStatus: LineConversationAiStatus.WAITING_ADMIN }), {
    action: "store_only",
    deliveryMode: LineDeliveryMode.NONE,
    reason: "CONVERSATION_WAITING_ADMIN",
  });
});

test("dry run stores suggestion only", () => {
  assert.deepEqual(decision({ dryRun: true }), {
    action: "store_only",
    deliveryMode: LineDeliveryMode.NONE,
    reason: "DRY_RUN",
  });
});

test("admin-only intents hand off", () => {
  assert.deepEqual(
    decision({
      route: {
        intent: LineIntent.CLAIM_OR_RETURN,
        allowsSearch: false,
        requiresAdmin: true,
        requiresImageAnalysis: false,
        requiresMoreInfo: false,
        reason: "CLAIM_KEYWORD",
      },
    }),
    {
      action: "handoff",
      deliveryMode: LineDeliveryMode.NONE,
      reason: "ADMIN_REQUIRED_CLAIM_OR_RETURN",
    },
  );
});

test("need-more-info can reply when route is safe", () => {
  assert.deepEqual(decision({ confidence: LineAiConfidence.NEED_MORE_INFO }), {
    action: "send",
    deliveryMode: LineDeliveryMode.REPLY,
    reason: "ASK_MORE_INFO",
  });
});

test("webhook-context replies prefer replyMessage delivery", () => {
  assert.deepEqual(decision({ hasReplyToken: true, allowPushFallback: true }), {
    action: "send",
    deliveryMode: LineDeliveryMode.REPLY,
    reason: "CONFIDENCE_CONFIRMED",
  });
});

test("push fallback is used only when no reply token is available and fallback is allowed", () => {
  assert.deepEqual(decision({ hasReplyToken: false, allowPushFallback: true }), {
    action: "send",
    deliveryMode: LineDeliveryMode.PUSH,
    reason: "CONFIDENCE_CONFIRMED",
  });
});
