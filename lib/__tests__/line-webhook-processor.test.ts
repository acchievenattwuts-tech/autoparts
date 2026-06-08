import test from "node:test";
import assert from "node:assert/strict";

import {
  LineAiConfidence,
  LineConversationAiStatus,
  LineDeliveryMode,
  LineIntent,
  LineMessageDirection,
  PaymentSlipVerificationStatus,
} from "@/lib/generated/prisma";
import {
  type LineWebhookProcessorDependencies,
} from "@/lib/line-webhook-processor";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

type TestCalls = {
  appendedDirections: LineMessageDirection[];
  appendedInboundEventIds: Array<string | null>;
  auditActions: string[];
  statePatchTypes: string[];
  suggestions: Array<{ confidence: LineAiConfidence; deliveryMode?: LineDeliveryMode | null }>;
  replies: Array<{ replyToken: string; text: string }>;
  markedSent: Array<{ messageId: string; deliveryMode: LineDeliveryMode }>;
  searches: string[];
  conversationInputs: Array<{ lineUserId: string; customerId?: string | null }>;
  ocrCalls: number;
  createdSlips: Array<{ conversationId: string; lineUserId: string }>;
};

function textPayload(text: string, lineEventId = "event-1") {
  return {
    events: [
      {
        type: "message",
        webhookEventId: lineEventId,
        replyToken: "reply-token-1",
        source: { type: "user", userId: "line-user-1" },
        message: { id: "line-message-1", type: "text", text },
      },
    ],
  };
}

function multiTextPayload(
  events: Array<{ text: string; lineEventId: string; userId?: string }>,
) {
  return {
    events: events.map((event) => ({
      type: "message",
      webhookEventId: event.lineEventId,
      replyToken: `reply-${event.lineEventId}`,
      source: { type: "user", userId: event.userId ?? "line-user-1" },
      message: { id: `message-${event.lineEventId}`, type: "text", text: event.text },
    })),
  };
}

function imagePayload(lineEventId = "event-img-1") {
  return {
    events: [
      {
        type: "message",
        webhookEventId: lineEventId,
        replyToken: `reply-${lineEventId}`,
        source: { type: "user", userId: "line-user-1" },
        message: { id: `message-${lineEventId}`, type: "image" },
      },
    ],
  };
}

function createProcessorTestDeps(input?: {
  duplicate?: boolean;
  duplicateEventIds?: string[];
  conversationStatus?: LineConversationAiStatus;
  linkedCustomerId?: string | null;
  imageKind?: "part_image" | "payment_slip" | "unknown_image";
  imageHints?: string[];
}) {
  const calls: TestCalls = {
    appendedDirections: [],
    appendedInboundEventIds: [],
    auditActions: [],
    statePatchTypes: [],
    suggestions: [],
    replies: [],
    markedSent: [],
    searches: [],
    conversationInputs: [],
    ocrCalls: 0,
    createdSlips: [],
  };
  let messageSeq = 0;
  const duplicateEventIds = new Set(input?.duplicateEventIds ?? []);

  const dependencies: LineWebhookProcessorDependencies = {
    hasProcessedLineEvent: async (lineEventId) =>
      Boolean(input?.duplicate) || (typeof lineEventId === "string" && duplicateEventIds.has(lineEventId)),
    findActiveCustomerIdByLineUserId: async () => input?.linkedCustomerId ?? null,
    getOrCreateLineConversation: async (conversationInput) => {
      calls.conversationInputs.push(conversationInput);
      return ({
        id: `conversation-${conversationInput.lineUserId}`,
        lineUserId: conversationInput.lineUserId,
        customerId: conversationInput.customerId,
        aiStatus: input?.conversationStatus ?? LineConversationAiStatus.ACTIVE,
      }) as Awaited<ReturnType<LineWebhookProcessorDependencies["getOrCreateLineConversation"]>>;
    },
    appendLineMessage: async (message) => {
      messageSeq += 1;
      calls.appendedDirections.push(message.direction);
      if (message.direction === LineMessageDirection.INBOUND) {
        calls.appendedInboundEventIds.push(message.lineEventId ?? null);
      }
      return {
        id: `message-${messageSeq}`,
        createdAt: new Date("2026-06-08T00:00:00.000Z"),
      } as Awaited<ReturnType<LineWebhookProcessorDependencies["appendLineMessage"]>>;
    },
    updateLineConversationState: async (_conversationId, patch) => {
      calls.statePatchTypes.push(
        patch.aiStatus === LineConversationAiStatus.WAITING_ADMIN ? "waiting_admin" : "state_update",
      );
      return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["updateLineConversationState"]>>;
    },
    storeLineAiAudit: async (input) => {
      calls.auditActions.push(input.action);
      return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
    },
    storeLineAiSuggestion: async (input) => {
      calls.suggestions.push({
        confidence: input.confidence,
        deliveryMode: input.deliveryMode,
      });
      return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiSuggestion"]>>;
    },
    markOutboundLineMessageSent: async (input) => {
      calls.markedSent.push(input);
      return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["markOutboundLineMessageSent"]>>;
    },
    searchLineProductInquiry: async (input) => {
      if (!input.route.allowsSearch) {
        return { searched: false, reason: "NON_SEARCHABLE_INTENT", query: null, result: null };
      }
      calls.searches.push(input.text ?? (input.extractedImageHints ?? []).join(" "));
      return {
        searched: true,
        reason: "SEARCHED_PRODUCT_INQUIRY",
        query: input.text ?? "",
        result: {
          ids: ["product-1"],
          total: 1,
          mode: "v2",
        },
        needsMoreInfo: false,
      };
    },
    replyLineMessage: async (input) => {
      calls.replies.push({
        replyToken: input.replyToken,
        text: input.messages[0]?.type === "text" ? input.messages[0].text : "",
      });
      return {
        sent: true,
        replyToken: input.replyToken,
      };
    },
    classifyLineImage: async () => {
      const kind = input?.imageKind ?? "part_image";
      const intent =
        kind === "payment_slip"
          ? LineIntent.PAYMENT_SLIP_IMAGE
          : kind === "part_image"
            ? LineIntent.PART_IMAGE_INQUIRY
            : LineIntent.UNKNOWN;
      return {
        kind,
        intent,
        searchHints: input?.imageHints ?? [],
        confidence: "LOW" as const,
        reason: "TEST_STUB",
      };
    },
    ingestPaymentSlip: async (slipInput) => {
      calls.ocrCalls += 1;
      calls.createdSlips.push({ conversationId: slipInput.conversationId, lineUserId: slipInput.lineUserId });
      return {
        slipId: "slip-1",
        verificationStatus: PaymentSlipVerificationStatus.PENDING_REVIEW,
        ocr: {
          amount: 1000,
          transferDatetimeIso: null,
          bank: "ธนาคารทดสอบ",
          senderName: null,
          receiverName: null,
          referenceNo: null,
          rawText: null,
        },
        imageStored: true,
      };
    },
  };

  return { calls, dependencies };
}

test("processor ignores duplicate webhook events without appending messages", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ duplicate: true });

  const result = await processLineWebhookPayload(
    textPayload("vios 1234"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.deepEqual(result, {
    processedCount: 0,
    duplicateCount: 1,
    skippedCount: 0,
    repliedCount: 0,
  });
  assert.deepEqual(calls.appendedDirections, []);
  assert.deepEqual(calls.replies, []);
});

test("processor creates conversation message and sends webhook reply via replyMessage", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("vios 1234"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 1);
  assert.deepEqual(calls.conversationInputs, [{ lineUserId: "line-user-1", customerId: null }]);
  assert.deepEqual(calls.appendedDirections, [
    LineMessageDirection.INBOUND,
    LineMessageDirection.OUTBOUND_AI,
  ]);
  assert.equal(calls.replies.length, 1);
  assert.equal(calls.replies[0]?.replyToken, "reply-token-1");
  assert.deepEqual(calls.markedSent, [{ messageId: "message-2", deliveryMode: LineDeliveryMode.REPLY }]);
  assert.ok(calls.auditActions.includes("INBOUND_EVENT_ACCEPTED"));
  assert.ok(calls.auditActions.includes("PRODUCT_SEARCH_SUMMARY"));
});

test("processor links conversation to exact active customer line user id", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ linkedCustomerId: "customer-1" });

  const result = await processLineWebhookPayload(
    textPayload("vios 1234"),
    { channelAccessToken: "token", autoReplyEnabled: false, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.conversationInputs, [{ lineUserId: "line-user-1", customerId: "customer-1" }]);
});

test("processor stores suggestion but does not send while conversation is paused", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    conversationStatus: LineConversationAiStatus.PAUSED_BY_ADMIN,
  });

  const result = await processLineWebhookPayload(
    textPayload("vios 1234"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 0);
  assert.deepEqual(calls.appendedDirections, [LineMessageDirection.INBOUND]);
  assert.equal(calls.suggestions.length, 1);
  assert.equal(calls.suggestions[0]?.deliveryMode, LineDeliveryMode.NONE);
  assert.deepEqual(calls.replies, []);
  assert.deepEqual(calls.markedSent, []);
});

test("processor routes unknown intent to waiting-admin without product-search reply", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("asdf qwer"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 0);
  assert.deepEqual(calls.searches, []);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.deepEqual(calls.replies, []);
});

test("processor handles a new event and skips an already-seen event in the same batch", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ duplicateEventIds: ["event-1"] });

  const result = await processLineWebhookPayload(
    multiTextPayload([
      { text: "vios 1234", lineEventId: "event-1" },
      { text: "civic 5678", lineEventId: "event-2" },
    ]),
    { channelAccessToken: "token", autoReplyEnabled: false, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.skippedCount, 0);
  // Only the non-duplicate event creates an inbound message.
  assert.deepEqual(calls.appendedInboundEventIds, ["event-2"]);
  assert.deepEqual(calls.conversationInputs, [{ lineUserId: "line-user-1", customerId: null }]);
});

test("processor routes a payment-slip image to admin and never hits product search", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ imageKind: "payment_slip" });

  const result = await processLineWebhookPayload(
    imagePayload(),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 0);
  assert.deepEqual(calls.searches, []);
  assert.ok(calls.auditActions.includes("IMAGE_CLASSIFIED"));
  assert.ok(calls.auditActions.includes("PAYMENT_SLIP_OCR"));
  assert.equal(calls.ocrCalls, 1);
  assert.deepEqual(calls.createdSlips, [
    { conversationId: "conversation-line-user-1", lineUserId: "line-user-1" },
  ]);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.deepEqual(calls.replies, []);
});

test("processor enters image workflow for a part image without product search", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ imageKind: "part_image" });

  const result = await processLineWebhookPayload(
    imagePayload("event-img-2"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.ok(calls.auditActions.includes("IMAGE_CLASSIFIED"));
  // Part images are conservative: no auto product search, handed to admin.
  assert.deepEqual(calls.searches, []);
  assert.deepEqual(calls.replies, []);
});

test("part image searches the catalog when image-search flag is on and hints exist", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageHints: ["คอมแอร์", "vios"],
  });

  const result = await processLineWebhookPayload(
    imagePayload("event-img-3"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, imageSearchEnabled: true },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.ok(calls.auditActions.includes("IMAGE_CLASSIFIED"));
  assert.equal(calls.searches.length, 1);
});

test("part image does not search when image-search flag is off even with hints", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageHints: ["คอมแอร์", "vios"],
  });

  const result = await processLineWebhookPayload(
    imagePayload("event-img-4"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, imageSearchEnabled: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.searches, []);
});

test("processor reuses the same conversation for two distinct messages from one user", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    multiTextPayload([
      { text: "vios 1234", lineEventId: "event-10" },
      { text: "civic 5678", lineEventId: "event-11" },
    ]),
    { channelAccessToken: "token", autoReplyEnabled: false, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 2);
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(calls.appendedInboundEventIds, ["event-10", "event-11"]);
  // Both events resolve to the same lineUserId (one conversation reused via upsert).
  assert.deepEqual(calls.conversationInputs, [
    { lineUserId: "line-user-1", customerId: null },
    { lineUserId: "line-user-1", customerId: null },
  ]);
});
