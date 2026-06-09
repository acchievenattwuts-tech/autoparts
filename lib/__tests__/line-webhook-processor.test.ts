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
import type { LineMessageContent } from "@/lib/line-messaging";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

type TestCalls = {
  appendedDirections: LineMessageDirection[];
  appendedInboundEventIds: Array<string | null>;
  auditActions: string[];
  statePatchTypes: string[];
  suggestions: Array<{ confidence: LineAiConfidence; deliveryMode?: LineDeliveryMode | null }>;
  replies: Array<{ replyToken: string; text: string }>;
  pushes: Array<{ recipientIds: string[]; text: string }>;
  markedSent: Array<{ messageId: string; deliveryMode: LineDeliveryMode }>;
  searches: string[];
  searchFitmentHints: Array<
    | {
        categoryName?: string | null;
        carBrandName?: string | null;
        carModelName?: string | null;
        fitmentYear?: number | null;
      }
    | null
  >;
  conversationInputs: Array<{ lineUserId: string; customerId?: string | null }>;
  conversationProfileInputs: Array<{ displayName?: string | null; pictureUrl?: string | null }>;
  ocrCalls: number;
  createdSlips: Array<{ conversationId: string; lineUserId: string }>;
  reusedSlipContent: boolean;
  notifyHandoffs: Array<{ conversationId: string; text?: string | null }>;
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

function stickerPayload(lineEventId = "event-sticker-1") {
  return {
    events: [
      {
        type: "message",
        webhookEventId: lineEventId,
        replyToken: `reply-${lineEventId}`,
        source: { type: "user", userId: "line-user-1" },
        message: { id: `message-${lineEventId}`, type: "sticker" },
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
  failedSearchCount?: number;
  purchaseIntent?: boolean;
  faqReply?: string;
  lastCustomerMessageAt?: Date | null;
  consolidatedQuery?: string | null;
  intentPartType?: string | null;
  intentCarBrand?: string | null;
  intentCarModel?: string | null;
  intentYear?: number | null;
  fitmentFilters?: { categoryName?: string; carBrandName?: string; carModelName?: string };
  nonProductTurn?: boolean;
  intentGroup?:
    | "product"
    | "shop_info"
    | "general_faq"
    | "payment"
    | "shipping_address"
    | "order_status"
    | "price_negotiation"
    | "claim_or_return"
    | "purchase"
    | "greeting"
    | "social"
    | "other";
}) {
  const calls: TestCalls = {
    appendedDirections: [],
    appendedInboundEventIds: [],
    auditActions: [],
    statePatchTypes: [],
    suggestions: [],
    replies: [],
    pushes: [],
    markedSent: [],
    searches: [],
    searchFitmentHints: [],
    conversationInputs: [],
    conversationProfileInputs: [],
    ocrCalls: 0,
    createdSlips: [],
    reusedSlipContent: false,
    notifyHandoffs: [],
  };
  let messageSeq = 0;
  const duplicateEventIds = new Set(input?.duplicateEventIds ?? []);

  const dependencies: LineWebhookProcessorDependencies = {
    hasProcessedLineEvent: async (lineEventId) =>
      Boolean(input?.duplicate) || (typeof lineEventId === "string" && duplicateEventIds.has(lineEventId)),
    findActiveCustomerIdByLineUserId: async () => input?.linkedCustomerId ?? null,
    getOrCreateLineConversation: async (conversationInput) => {
      calls.conversationInputs.push({
        lineUserId: conversationInput.lineUserId,
        customerId: conversationInput.customerId,
      });
      calls.conversationProfileInputs.push({
        displayName: conversationInput.displayName,
        pictureUrl: conversationInput.pictureUrl,
      });
      return ({
        id: `conversation-${conversationInput.lineUserId}`,
        lineUserId: conversationInput.lineUserId,
        customerId: conversationInput.customerId,
        aiStatus: input?.conversationStatus ?? LineConversationAiStatus.ACTIVE,
        lastCustomerMessageAt: input?.lastCustomerMessageAt ?? null,
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
    storeLineAiJob: async (jobInput) =>
      ({
        id: `job-${calls.conversationInputs.length}`,
        ...jobInput,
      }) as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiJob"]>>,
    updateLineAiJob: async () =>
      ({}) as Awaited<ReturnType<LineWebhookProcessorDependencies["updateLineAiJob"]>>,
    markOutboundLineMessageSent: async (input) => {
      calls.markedSent.push(input);
      return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["markOutboundLineMessageSent"]>>;
    },
    searchLineProductInquiry: async (input) => {
      if (!input.route.allowsSearch) {
        return { searched: false, reason: "NON_SEARCHABLE_INTENT", query: null, result: null };
      }
      calls.searches.push(input.text ?? (input.extractedImageHints ?? []).join(" "));
      calls.searchFitmentHints.push(input.fitmentHints ?? null);
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
    pushLineMessages: async (input) => {
      calls.pushes.push({
        recipientIds: input.recipientIds,
        text: input.messages[0]?.type === "text" ? input.messages[0].text : "",
      });
      return {
        sentCount: input.recipientIds.length,
        recipientIds: input.recipientIds,
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
      calls.reusedSlipContent = Boolean(slipInput.content);
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
    notifyLineOaNeedsAdmin: async (notifyInput) => {
      calls.notifyHandoffs.push({ conversationId: notifyInput.conversationId, text: notifyInput.text });
      return 1;
    },
    getRecentLineMessagesForAi: async () => [],
    getLineProductSummaries: async () => [],
    countConsecutiveFailedLineSearches: async () => input?.failedSearchCount ?? 0,
    classifyPurchaseIntent: async () => input?.purchaseIntent ?? false,
    answerFromLineFaq: async () =>
      input?.faqReply ? { answered: true, reply: input.faqReply } : { answered: false, reply: "" },
    // Default: no extraction (mirrors Gemini-off / first-turn), so the search
    // falls back to the latest text. Tests that exercise carryover set it.
    extractLineSearchIntent: async () =>
      input?.nonProductTurn
        ? {
            group: input?.intentGroup ?? "other",
            query: "",
            isProductQuery: false,
            partType: null,
            carBrand: null,
            carModel: null,
            year: null,
          }
        : input?.consolidatedQuery
        ? {
            group: "product",
            query: input.consolidatedQuery,
            isProductQuery: true,
            partType: input?.intentPartType ?? null,
            carBrand: input?.intentCarBrand ?? null,
            carModel: input?.intentCarModel ?? null,
            year: input?.intentYear ?? null,
          }
        : null,
    resolveLineFitmentFilters: async () => input?.fitmentFilters ?? {},
  };

  return { calls, dependencies };
}

function testImageContent(): LineMessageContent {
  return {
    mimeType: "image/jpeg",
    dataBase64: Buffer.from("test-image").toString("base64"),
  };
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
  assert.deepEqual(calls.pushes, []);
  assert.deepEqual(calls.markedSent, [{ messageId: "message-2", deliveryMode: LineDeliveryMode.REPLY }]);
  assert.ok(calls.auditActions.includes("INBOUND_EVENT_ACCEPTED"));
  assert.ok(calls.auditActions.includes("PRODUCT_SEARCH_SUMMARY"));
  // AI replied successfully → no admin handoff notification.
  assert.deepEqual(calls.notifyHandoffs, []);
});

test("processor notifies admins when AI cannot auto-reply (conversation paused)", async () => {
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
  // No auto-reply was delivered → exactly one handoff notification for the conversation.
  assert.equal(calls.notifyHandoffs.length, 1);
  assert.equal(calls.notifyHandoffs[0]?.conversationId, "conversation-line-user-1");
  assert.equal(calls.notifyHandoffs[0]?.text, "vios 1234");
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

test("processor falls back to push when reply token is too old for safe reply", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("vios 1234"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      allowPushFallback: true,
      receivedAt: new Date(Date.now() - 90_000),
      replyTokenMaxAgeMs: 45_000,
    },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 1);
  assert.deepEqual(calls.replies, []);
  assert.equal(calls.pushes.length, 1);
  assert.deepEqual(calls.pushes[0]?.recipientIds, ["line-user-1"]);
  assert.deepEqual(calls.markedSent, [{ messageId: "message-2", deliveryMode: LineDeliveryMode.PUSH }]);
});

test("processor stores line profile name as conversation fallback when no customer is linked", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("สอบถามอะไหล่"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: false,
      dryRun: false,
      lineProfilesByUserId: {
        "line-user-1": {
          displayName: "คุณสมชาย",
          pictureUrl: "https://line.example/avatar.jpg",
        },
      },
    },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.conversationInputs, [{ lineUserId: "line-user-1", customerId: null }]);
  assert.deepEqual(calls.conversationProfileInputs, [
    { displayName: "คุณสมชาย", pictureUrl: "https://line.example/avatar.jpg" },
  ]);
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

test("admin-only intent sends a polite ack, then hands off to admin (no search)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  // A claim/return message → requiresAdmin: acknowledge politely, then hand off.
  const result = await processLineWebhookPayload(
    textPayload("ขอเคลมของพัง"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 1);
  assert.deepEqual(calls.searches, []);
  assert.match(calls.replies[0]?.text ?? "", /เคลม/);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
});

test("shop-info keyword is auto-answered with the canned reply, no handoff", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("ร้านเปิดกี่โมงคะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /08:30 - 18:00/);
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 0);
  assert.deepEqual(calls.searches, []);
});

test("'เมนู' is ignored entirely — no reply, no handoff, AI stays active", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("เมนู"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 0);
  assert.deepEqual(calls.replies, []);
  assert.deepEqual(calls.pushes, []);
  assert.equal(calls.notifyHandoffs.length, 0);
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.suggestions.length, 0);
});

test("sticker on a fresh contact greets once, no handoff, no notify", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // lastCustomerMessageAt = null → treated as a fresh contact.
  const { calls, dependencies } = createProcessorTestDeps({ lastCustomerMessageAt: null });

  const result = await processLineWebhookPayload(
    stickerPayload(),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 1);
  assert.equal(calls.replies.length, 1);
  assert.match(calls.replies[0]?.text ?? "", /สวัสดีค่ะ/);
  // Never search, never hand off, never notify on a sticker.
  assert.deepEqual(calls.searches, []);
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 0);
  assert.ok(calls.auditActions.includes("STICKER_HANDLED"));
});

test("sticker mid-conversation is silent — no reply, no handoff, no notify", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // A recent customer turn → the sticker is a conversation-closer, stay silent.
  const { calls, dependencies } = createProcessorTestDeps({
    lastCustomerMessageAt: new Date(Date.now() - 60_000),
  });

  const result = await processLineWebhookPayload(
    stickerPayload(),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 0);
  assert.deepEqual(calls.replies, []);
  assert.deepEqual(calls.pushes, []);
  assert.equal(calls.notifyHandoffs.length, 0);
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
  // Only the inbound sticker is appended — no outbound greeting.
  assert.deepEqual(calls.appendedDirections, [LineMessageDirection.INBOUND]);
});

test("drip-fed follow-up searches the AI-consolidated query, not the latest fragment", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // Customer earlier said "คอยเย็น d max", now just sends "ปี 06". The AI consolidates
  // the running subject; the search must run on that, not on "ปี 06" alone.
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "คอยล์เย็น d-max 2006",
  });

  const result = await processLineWebhookPayload(
    textPayload("ปี 06"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.searches, ["คอยล์เย็น d-max 2006"]);
  assert.ok(calls.auditActions.includes("SEARCH_QUERY_CONSOLIDATED"));
});

test("resolved fitment hints are passed as hard filters to search", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ mazda 2",
    intentCarBrand: "Mazda",
    intentCarModel: "Mazda 2",
    intentPartType: "หม้อน้ำ",
    intentYear: 2015,
    // Resolver confirmed these against master data.
    fitmentFilters: { categoryName: "หม้อน้ำ", carBrandName: "Mazda", carModelName: "2" },
  });

  const result = await processLineWebhookPayload(
    textPayload("ปี 15"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.searches, ["หม้อน้ำ mazda 2"]);
  assert.deepEqual(calls.searchFitmentHints[0], {
    categoryName: "หม้อน้ำ",
    carBrandName: "Mazda",
    carModelName: "2",
    fitmentYear: 2015,
  });
});

test("non-product turn skips search and product cards entirely", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // "ขอบคุณมากค่ะ" routes to PRODUCT_INQUIRY_TEXT (allowsSearch) by default, so
  // without intent-gating it WOULD search; the AI flags it non-product → skip.
  const { calls, dependencies } = createProcessorTestDeps({ nonProductTurn: true });

  const result = await processLineWebhookPayload(
    textPayload("ขอบคุณมากค่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  // No product search ran, and no SEARCH_QUERY_CONSOLIDATED audit.
  assert.deepEqual(calls.searches, []);
  assert.ok(calls.auditActions.includes("SEARCH_SKIPPED_NON_PRODUCT"));
  assert.ok(!calls.auditActions.includes("SEARCH_QUERY_CONSOLIDATED"));
});

test("non-product turn is answered from FAQ (not handed off) when the FAQ covers it", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // A general question the keyword router didn't catch as SHOP_INFO; AI flags it
  // non-product and the FAQ can answer → reply with the FAQ answer, no handoff.
  const { calls, dependencies } = createProcessorTestDeps({
    nonProductTurn: true,
    faqReply: "ร้านศรีวรรณอยู่ปทุมธานีค่ะ 🙏",
  });

  const result = await processLineWebhookPayload(
    textPayload("อยากทราบข้อมูลร้านหน่อยค่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /ปทุมธานี/);
  assert.deepEqual(calls.searches, []);
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 0);
});

test("social group gets a brief ack and never searches", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ nonProductTurn: true, intentGroup: "social" });

  const result = await processLineWebhookPayload(
    textPayload("ขอบคุณมากค่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /ยินดี/);
  assert.deepEqual(calls.searches, []);
  assert.ok(calls.auditActions.includes("SOCIAL_HANDLED"));
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
});

test("shop_info group answers from the canned shop message, no search", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ nonProductTurn: true, intentGroup: "shop_info" });

  const result = await processLineWebhookPayload(
    textPayload("อยากทราบเกี่ยวกับร้านหน่อยค่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /08:30 - 18:00/);
  assert.deepEqual(calls.searches, []);
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
});

test("template/FAQ answers are suppressed once an admin has taken over", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    nonProductTurn: true,
    intentGroup: "shop_info",
    conversationStatus: LineConversationAiStatus.PAUSED_BY_ADMIN,
  });

  const result = await processLineWebhookPayload(
    textPayload("ร้านอยู่ไหนคะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 0);
  assert.deepEqual(calls.replies, []);
});

test("deadline fallback still replies on the free token when generate is too slow", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();
  // Reply generation never returns in time.
  dependencies.generateLineSuggestion = () => new Promise<never>(() => {});

  const result = await processLineWebhookPayload(
    textPayload("คอยล์เย็น vios"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      // 41s elapsed: past the 40s generation deadline (45s − 5s margin) but the
      // reply token (≤45s) is still valid → fallback must go out on the token.
      receivedAt: new Date(Date.now() - 41_000),
      replyTokenMaxAgeMs: 45_000,
    },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.replies.length, 1);
  assert.ok(calls.auditActions.includes("AI_DEADLINE_FALLBACK"));
});

test("search falls back to latest text when AI consolidation declines", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ consolidatedQuery: null });

  const result = await processLineWebhookPayload(
    textPayload("คอยเย็น vios"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.searches, ["คอยเย็น vios"]);
  assert.ok(!calls.auditActions.includes("SEARCH_QUERY_CONSOLIDATED"));
});

test("FAQ-answerable UNKNOWN question is answered from FAQ, not handed off", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ faqReply: "ร้านส่งต่างจังหวัดได้ค่ะ 🙏" });
  // Empty product search → FAQ gets a chance before asking-more/escalating.
  dependencies.searchLineProductInquiry = async () => ({
    searched: true,
    reason: "SEARCHED_PRODUCT_INQUIRY",
    query: "asdf qwer",
    result: { ids: [], total: 0, mode: "v2", matchReasons: {} },
    needsMoreInfo: true,
  });

  const result = await processLineWebhookPayload(
    textPayload("asdf qwer"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /ส่งต่างจังหวัด/);
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 0);
});

test("escalates to admin (waiting + notify + send-off message) after repeated empty searches", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ failedSearchCount: 2 });
  dependencies.searchLineProductInquiry = async () => ({
    searched: true,
    reason: "SEARCHED_PRODUCT_INQUIRY",
    query: "vios 1234",
    result: { ids: [], total: 0, mode: "v2" },
    needsMoreInfo: true,
  });

  const result = await processLineWebhookPayload(
    textPayload("vios 1234"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.replies.length, 1);
  assert.match(calls.replies[0]?.text ?? "", /ส่งต่อให้แอดมิน/);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.ok(calls.auditActions.includes("AI_ESCALATE_NO_RESULTS"));
  assert.equal(calls.notifyHandoffs.length, 1);
});

test("purchase keyword hands off to admin with a bridging message", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("เอาตัวนี้เลยค่ะ สั่งซื้อ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /แอดมินมาดูแลเรื่องสั่งซื้อ/);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.ok(calls.auditActions.includes("AI_PURCHASE_HANDOFF"));
  assert.equal(calls.notifyHandoffs.length, 1);
  // No product search/cards for a pure purchase keyword.
  assert.deepEqual(calls.searches, []);
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
  assert.equal(result.repliedCount, 1);
  assert.deepEqual(calls.searches, []);
  assert.ok(calls.auditActions.includes("IMAGE_CLASSIFIED"));
  assert.ok(calls.auditActions.includes("PAYMENT_SLIP_OCR"));
  assert.equal(calls.ocrCalls, 1);
  assert.deepEqual(calls.createdSlips, [
    { conversationId: "conversation-line-user-1", lineUserId: "line-user-1" },
  ]);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(
    calls.replies[0]?.text ?? "",
    "ขอบคุณค่ะ ทางร้านได้รับสลิปเรียบร้อยแล้วนะคะ 🙏\nขอเวลาให้แอดมินตรวจสอบยอดโอนสักครู่ แล้วจะแจ้งกลับให้ทราบทางแชทนี้ค่ะ",
  );
});

test("processor reuses classified payment-slip image content for slip ingest", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ imageKind: "payment_slip" });

  dependencies.classifyLineImage = async () => ({
    kind: "payment_slip",
    intent: LineIntent.PAYMENT_SLIP_IMAGE,
    searchHints: [],
    confidence: "HIGH",
    reason: "TEST_STUB",
    content: testImageContent(),
  });

  const result = await processLineWebhookPayload(
    imagePayload("event-img-reuse"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(calls.reusedSlipContent, true);
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
  // Part images are conservative: no auto product search, acked then handed to admin.
  assert.deepEqual(calls.searches, []);
  assert.match(calls.replies[0]?.text ?? "", /แอดมิน/);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
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
