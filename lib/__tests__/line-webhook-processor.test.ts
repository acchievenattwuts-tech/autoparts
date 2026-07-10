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
  replies: Array<{ replyToken: string; text: string; messageCount: number; texts: string[] }>;
  pushes: Array<{ recipientIds: string[]; text: string }>;
  loadingAnimations: Array<{ chatId: string; loadingSeconds?: number }>;
  markedSent: Array<{ messageId: string; deliveryMode: LineDeliveryMode }>;
  scopedReplyGroups: string[];
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
  savedFrames: Array<{
    partType: string | null;
    carBrand: string | null;
    carModel: string | null;
    year: number | null;
  }>;
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
  priceTier?: "RETAIL" | "WHOLESALE";
  imageKind?: "part_image" | "payment_slip" | "unknown_image";
  imageConfidence?: "LOW" | "MEDIUM" | "HIGH";
  imageHints?: string[];
  imagePartType?: string | null;
  imageCarBrand?: string | null;
  imageCarModel?: string | null;
  imageYear?: number | null;
  imagePartKind?: "fitment" | "universal" | null;
  imagePartNumber?: string | null;
  /** Codes that the resolveCatalogCodes mock treats as existing in the catalog. */
  catalogCodes?: string[];
  failedSearchCount?: number;
  searchTotal?: number;
  searchIds?: string[];
  purchaseIntent?: boolean;
  faqReply?: string;
  lastCustomerMessageAt?: Date | null;
  consolidatedQuery?: string | null;
  intentPartType?: string | null;
  intentCarBrand?: string | null;
  intentCarModel?: string | null;
  intentYear?: number | null;
  intentPartKind?: "fitment" | "universal" | null;
  intentTooBroad?: boolean;
  storedFrame?: {
    partType?: string | null;
    carBrand?: string | null;
    carModel?: string | null;
    year?: number | null;
  } | null;
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
    | "smalltalk"
    | "out_of_scope"
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
    loadingAnimations: [],
    markedSent: [],
    scopedReplyGroups: [],
    searches: [],
    searchFitmentHints: [],
    conversationInputs: [],
    conversationProfileInputs: [],
    ocrCalls: 0,
    createdSlips: [],
    reusedSlipContent: false,
    notifyHandoffs: [],
    savedFrames: [],
  };
  let messageSeq = 0;
  const duplicateEventIds = new Set(input?.duplicateEventIds ?? []);
  const configuredSearchIds = input?.searchIds ?? ["product-1"];
  const configuredSearchTotal = input?.searchTotal ?? configuredSearchIds.length;

  const dependencies: LineWebhookProcessorDependencies = {
    hasProcessedLineEvent: async (lineEventId) =>
      Boolean(input?.duplicate) || (typeof lineEventId === "string" && duplicateEventIds.has(lineEventId)),
    findActiveCustomerIdByLineUserId: async () => input?.linkedCustomerId ?? null,
    // Default to WHOLESALE so existing structural tests keep their original prices;
    // retail-tier behavior is covered by dedicated cases that pass priceTier: "RETAIL".
    resolveLinePriceTier: async () => input?.priceTier ?? "WHOLESALE",
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
    // Never hit the live LLM fallback in unit tests — keep the flow deterministic.
    correctPartSpelling: async () => null,
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
    searchChatProductInquiry: async (input) => {
      if (!input.route.allowsSearch) {
        return { searched: false, reason: "NON_SEARCHABLE_INTENT", query: null, result: null };
      }
      calls.searches.push(
        input.extractedPartNumber ?? input.text ?? (input.extractedImageHints ?? []).join(" "),
      );
      calls.searchFitmentHints.push(input.fitmentHints ?? null);
      // Mirror the real bridge: a specific fitment part that anchored to zero
      // matches surfaces the SEARCHED_FITMENT_PART_NO_MATCH reason.
      const stubReason =
        input.fitmentPartHeadNoun && configuredSearchTotal === 0
          ? "SEARCHED_FITMENT_PART_NO_MATCH"
          : "SEARCHED_PRODUCT_INQUIRY";
      return {
        searched: true,
        reason: stubReason,
        query: input.text ?? "",
        result: {
          ids: configuredSearchIds,
          total: configuredSearchTotal,
          mode: "v2",
        },
        needsMoreInfo: configuredSearchTotal === 0 || configuredSearchIds.length === 0,
        appliedFilters: {
          categoryName: input.fitmentHints?.categoryName ?? null,
          carBrandName: input.fitmentHints?.carBrandName ?? null,
          carModelName: input.fitmentHints?.carModelName ?? null,
          fitmentYear: input.fitmentHints?.fitmentYear ?? null,
        },
        droppedImageCodes: [],
        didYouMean: null,
      };
    },
    replyLineMessage: async (input) => {
      calls.replies.push({
        replyToken: input.replyToken,
        text: input.messages[0]?.type === "text" ? input.messages[0].text : "",
        messageCount: input.messages.length,
        texts: input.messages.map((m) => (m.type === "text" ? m.text : `[${m.type}]`)),
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
    startLineLoadingAnimation: async (input) => {
      calls.loadingAnimations.push({ chatId: input.chatId, loadingSeconds: input.loadingSeconds });
      return input.chatId.startsWith("U");
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
        confidence: input?.imageConfidence ?? ("HIGH" as const),
        reason: "TEST_STUB",
        partType: input?.imagePartType ?? null,
        carBrand: input?.imageCarBrand ?? null,
        carModel: input?.imageCarModel ?? null,
        year: input?.imageYear ?? null,
        partKind: input?.imagePartKind ?? null,
        partNumber: input?.imagePartNumber ?? null,
      };
    },
    resolveCatalogCodes: async (codes: string[]) =>
      codes.filter((code) => (input?.catalogCodes ?? []).includes(code)),
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
    // Default: a showable summary for every matched id, so the default search is a
    // normal successful match (an EMPTY summary list against total>0 now trips the
    // "matched but none showable" hand-off, which several tests would otherwise hit
    // unintentionally). Tests that need specific products override this.
    getChatProductSummaries: async (ids: string[]) =>
      ids.map((id, index) => ({
        id,
        name: `สินค้า ${id}`,
        code: `P${String(index + 1).padStart(4, "0")}`,
        imageUrl: null,
        salePrice: 1000,
        retailPrice: 1000,
      })),
    countConsecutiveFailedLineSearches: async () => input?.failedSearchCount ?? 0,
    countPendingPaymentSlipsForConversation: async () => 0,
    classifyPurchaseIntent: async () => input?.purchaseIntent ?? false,
    answerFromChatFaq: async () =>
      input?.faqReply ? { answered: true, reply: input.faqReply } : { answered: false, reply: "" },
    // Default: no extraction (mirrors Gemini-off / first-turn), so the search
    // falls back to the latest text. Tests that exercise carryover set it.
    extractChatSearchIntent: async () =>
      input?.nonProductTurn
        ? {
            group: input?.intentGroup ?? "other",
            query: "",
            isProductQuery: false,
            partType: null,
            carBrand: null,
            carModel: null,
            year: null,
            partKind: null,
            tooBroad: false,
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
            // Default to universal so existing search-path tests still search
            // (the gate only blocks incomplete fitment turns).
            partKind: input?.intentPartKind ?? ("universal" as const),
            tooBroad: input?.intentTooBroad ?? false,
          }
        : null,
    getLineInquiryFrame: async () =>
      input?.storedFrame
        ? {
            partType: input.storedFrame.partType ?? null,
            carBrand: input.storedFrame.carBrand ?? null,
            carModel: input.storedFrame.carModel ?? null,
            year: input.storedFrame.year ?? null,
            updatedAt: new Date(), // fresh → same session
          }
        : null,
    updateLineInquiryFrame: async (frameInput) => {
      calls.savedFrames.push({
        partType: frameInput.partType,
        carBrand: frameInput.carBrand,
        carModel: frameInput.carModel,
        year: frameInput.year,
      });
    },
    resolveChatFitmentFilters: async (filterInput) => {
      const configured = input?.fitmentFilters ?? {};
      return {
        categoryName: configured.categoryName,
        carBrandName: filterInput.carBrand ? configured.carBrandName : undefined,
        carModelName: filterInput.carModel ? configured.carModelName : undefined,
      };
    },
    // Hermetic: never touch the DB for brand aliases in unit tests (the guard
    // falls back to the hardcoded brand map).
    loadCarBrandVariantLookup: async () => new Map<string, string[]>(),
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

test("processor starts LINE loading animation for text messages for 60 seconds", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  await processLineWebhookPayload(
    textPayload("vios 1234"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.deepEqual(calls.loadingAnimations, [{ chatId: "line-user-1", loadingSeconds: 60 }]);
});

test("processor starts LINE loading animation for image messages for 60 seconds", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  await processLineWebhookPayload(
    imagePayload(),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.deepEqual(calls.loadingAnimations, [{ chatId: "line-user-1", loadingSeconds: 60 }]);
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

test("service inquiry sends to admin without product search or car-model ask", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("\u0e23\u0e31\u0e1a\u0e2d\u0e31\u0e14\u0e2a\u0e32\u0e22\u0e41\u0e2d\u0e23\u0e4c\u0e44\u0e2b\u0e21\u0e04\u0e23\u0e31\u0e1a"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.repliedCount, 1);
  assert.deepEqual(calls.searches, []);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
  assert.doesNotMatch(calls.replies[0]?.text ?? "", /D-Max|Vios|Jazz|รุ่นรถ/);
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
    // Brand carryover in production lives in the persisted inquiry frame (an
    // earlier "หม้อน้ำ Mazda 2" turn). The follow-up "ปี 15" alone has no brand
    // evidence, so the per-turn guard drops the classifier's history-merged brand —
    // the frame is what keeps Mazda. Model with no numeric anchor is left intact.
    storedFrame: { partType: "หม้อน้ำ", carBrand: "Mazda", carModel: "Mazda 2" },
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

test("ungrounded AI car model rewrite falls back to the customer's literal query", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "คอมแอร์ Isuzu D-Max",
    intentPartType: "คอมแอร์",
    intentCarBrand: "Isuzu",
    intentCarModel: "D-Max",
    fitmentFilters: { categoryName: "คอมแอร์ (Compressor)", carBrandName: "Isuzu", carModelName: "D-Max" },
  });

  const result = await processLineWebhookPayload(
    textPayload("คอม dragon 709"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.searches, ["คอม dragon 709"]);
  assert.deepEqual(calls.searchFitmentHints[0], {
    categoryName: "คอมแอร์ (Compressor)",
    carBrandName: null,
    carModelName: null,
    fitmentYear: null,
  });
});

test("grounded Dragon Eye rewrite keeps resolved Isuzu Dragon Eye hard filters", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "คอมแอร์ Isuzu Dragon Eye 709",
    intentPartType: "คอมแอร์",
    intentCarBrand: "Isuzu",
    intentCarModel: "Dragon Eye",
    fitmentFilters: { categoryName: "คอมแอร์ (Compressor)", carBrandName: "Isuzu", carModelName: "Dragon Eye" },
  });

  const result = await processLineWebhookPayload(
    textPayload("คอม dragon 709"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.searches, ["คอมแอร์ Isuzu Dragon Eye 709"]);
  assert.deepEqual(calls.searchFitmentHints[0], {
    categoryName: "คอมแอร์ (Compressor)",
    carBrandName: "Isuzu",
    carModelName: "Dragon Eye",
    fitmentYear: null,
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

test("smalltalk group gets an AI scoped reply, no search, no handoff", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ nonProductTurn: true, intentGroup: "smalltalk" });
  dependencies.generateScopedConversationalReply = async ({ group }) => {
    calls.scopedReplyGroups.push(group);
    return "จูนเป็นผู้ช่วยร้านศรีวรรณค่ะ 😊 อยากหาอะไหล่รุ่นไหนดีคะ";
  };

  const result = await processLineWebhookPayload(
    textPayload("จูนคือใคร"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /จูน/);
  assert.deepEqual(calls.searches, []);
  assert.deepEqual(calls.scopedReplyGroups, ["smalltalk"]);
  assert.ok(calls.auditActions.includes("SCOPED_CONVERSATIONAL_HANDLED"));
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
});

test("out_of_scope group declines politely via scoped reply, no search", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ nonProductTurn: true, intentGroup: "out_of_scope" });

  const result = await processLineWebhookPayload(
    textPayload("วันนี้อากาศเป็นยังไงบ้าง"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  // No injected generator + no Gemini keys in test → deterministic template.
  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /อะไหล่แอร์/);
  assert.deepEqual(calls.searches, []);
  assert.ok(calls.auditActions.includes("SCOPED_CONVERSATIONAL_HANDLED"));
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
  dependencies.generateChatSuggestion = () => new Promise<never>(() => {});

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

test("deadline fallback after search keeps complete text search results", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ D-Max 2015",
    intentPartType: "หม้อน้ำ",
    intentCarModel: "D-Max",
    intentYear: 2015,
    intentPartKind: "fitment",
  });
  dependencies.generateChatSuggestion = () => new Promise<never>(() => {});

  const result = await processLineWebhookPayload(
    textPayload("หม้อน้ำ D-Max 2015"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      receivedAt: new Date(Date.now() - 41_000),
      replyTokenMaxAgeMs: 45_000,
    },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1);
  assert.equal(calls.replies.length, 1);
  assert.equal(calls.replies[0]?.replyToken, "reply-token-1");
  assert.match(calls.replies[0]?.text ?? "", /หม้อน้ำ D-Max 2015/);
  assert.ok(calls.auditActions.includes("AI_DEADLINE_FALLBACK"));
});

test("part-image turn near the reply-token deadline still searches (no pre-search bail)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageHints: ["คอมแอร์", "Valeo"],
    imagePartType: "คอมแอร์",
    imageCarModel: "D-Max",
    imageYear: 2015,
    imagePartKind: "fitment",
  });
  // Deterministic fast generation so the assertion doesn't race the real fallback.
  dependencies.generateChatSuggestion = async () => ({
    suggestedReply: "เจอรายการที่ใกล้เคียงค่ะ",
    confidence: LineAiConfidence.POSSIBLE_MATCH,
    reasoningSummary: "TEST",
  });

  const result = await processLineWebhookPayload(
    imagePayload("event-img-deadline"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      // 29s elapsed: the OLD logic bailed before searching (remaining ≤ 15s). The
      // OCR was already paid for, so the image turn must now run the search and
      // deliver on the still-valid reply token.
      receivedAt: new Date(Date.now() - 29_000),
      replyTokenMaxAgeMs: 45_000,
    },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.auditActions.includes("IMAGE_CLASSIFIED"));
  assert.equal(calls.searches.length, 1);
  assert.equal(calls.replies.length, 1);
  assert.equal(calls.replies[0]?.replyToken, "reply-event-img-deadline");
});

test("lone low-confidence part image hands off instead of guessing a search", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageConfidence: "LOW",
    imageHints: ["คอมแอร์"],
    imagePartType: "คอมแอร์",
    imagePartKind: "fitment",
  });

  const result = await processLineWebhookPayload(
    imagePayload("event-img-lowconf"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
    },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  // Never guesses — no search runs, and the AI stays active (no admin handoff).
  assert.deepEqual(calls.searches, []);
  assert.equal(calls.replies.length, 1);
  assert.ok(calls.auditActions.includes("AI_UNCERTAIN_PRODUCT_HANDOFF"));
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
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
  dependencies.searchChatProductInquiry = async () => ({
    searched: true,
    reason: "SEARCHED_PRODUCT_INQUIRY",
    query: "asdf qwer",
    result: { ids: [], total: 0, mode: "v2", matchReasons: {} },
    needsMoreInfo: true,
    appliedFilters: { categoryName: null, carBrandName: null, carModelName: null, fitmentYear: null },
    droppedImageCodes: [],
    didYouMean: null,
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

test("text product no-match with a product subject does not use generic FAQ fallback", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "คอยเย็น ABC123",
    intentPartType: "คอยล์เย็น",
    intentPartKind: "fitment",
    searchTotal: 0,
    searchIds: [],
    failedSearchCount: 0,
    faqReply: "FAQ should not answer this no-match product search",
  });

  const result = await processLineWebhookPayload(
    textPayload("คอยเย็น ABC123"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1);
  assert.equal(calls.replies.length, 1);
  assert.ok(!calls.replies[0]?.text.includes("FAQ should not answer"));
  assert.ok(calls.replies[0]?.text.includes("แอดมิน"));
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
});

test("search matched rows but none are showable → hands off + notifies (no silent dead-end)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "คอยเย็น vios",
    intentPartType: "คอยล์เย็น",
    intentCarModel: "Vios",
    intentPartKind: "fitment",
    searchTotal: 3, // the search matched rows...
    searchIds: ["product-hidden"],
  });
  // ...but every matched id is filtered out (inactive / hidden / fetch failed).
  dependencies.getChatProductSummaries = async () => [];

  const result = await processLineWebhookPayload(
    textPayload("คอยเย็น vios"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "room frozen for a human");
  assert.equal(calls.notifyHandoffs.length, 1, "admin notified — never a silent dead-end");
  assert.ok(calls.replies[0]?.text.includes("แอดมิน"));
});

test("escalates to admin (waiting + notify + send-off message) after repeated empty searches", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ failedSearchCount: 2 });
  dependencies.searchChatProductInquiry = async () => ({
    searched: true,
    reason: "SEARCHED_PRODUCT_INQUIRY",
    query: "vios 1234",
    result: { ids: [], total: 0, mode: "v2" },
    needsMoreInfo: true,
    appliedFilters: { categoryName: null, carBrandName: null, carModelName: null, fitmentYear: null },
    droppedImageCodes: [],
    didYouMean: null,
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
  assert.match(calls.replies[0]?.text ?? "", /แอดมินมาช่วยสรุปราคา/);
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

test("part image recognized but search empty → acknowledges the part + hands off, not the generic FAQ ask-for-photo", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageConfidence: "HIGH",
    imagePartType: "สายน้ำยาแอร์",
    // Car + year present so the completeness gate passes and this turn reaches the
    // actual product search (which comes back empty), mirroring the production case
    // where the customer's text supplied the vehicle.
    imageCarModel: "D-Max",
    imageYear: 2012,
    imageHints: ["สายน้ำยาแอร์", "D-Max"],
    // A FAQ answer is available — the fix must NOT use it for a recognized part
    // image with zero matches (it would read "send a photo of the part").
    faqReply: "สอบถามเรื่องจัดส่งได้เลยค่ะ",
  });
  dependencies.searchChatProductInquiry = async () => ({
    searched: true,
    reason: "SEARCHED_PRODUCT_INQUIRY",
    query: "สายน้ำยาแอร์",
    result: { ids: [], total: 0, mode: "v2" },
    needsMoreInfo: true,
    appliedFilters: { categoryName: null, carBrandName: null, carModelName: null, fitmentYear: null },
    droppedImageCodes: [],
    didYouMean: null,
  });

  const result = await processLineWebhookPayload(
    imagePayload("event-img-nomatch"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, imageSearchEnabled: true },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  const reply = calls.replies[0]?.text ?? "";
  assert.match(reply, /เห็นรูป/, "acknowledges the photo it saw");
  assert.match(reply, /สายน้ำยาแอร์/, "names the recognized part type");
  assert.match(reply, /แอดมิน/, "hands off to a human");
  assert.ok(!/ส่งรูปอะไหล่เดิม/.test(reply), "never asks for a photo the customer already sent");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "conversation handed off to admin");
  assert.ok(calls.auditActions.includes("AI_PART_IMAGE_NO_MATCH"));
  assert.equal(calls.notifyHandoffs.length, 1);
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

test("gate: fitment part with no car/year blocks search and asks for the vehicle (no freeze)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ",
    intentPartType: "หม้อน้ำ",
    intentPartKind: "fitment",
  });

  const result = await processLineWebhookPayload(
    textPayload("หม้อน้ำ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1, "still replies (asks for detail)");
  assert.equal(calls.searches.length, 0, "search is gated off until we have a car");
  assert.ok(calls.replies[0]?.text.includes("ยี่ห้อ"), "asks for the vehicle");
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"), "AI stays active, room not frozen");
});

test("broad aircon truck inquiry hands off immediately instead of guessing compressor products", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "อะไหล่แอร์ สิบล้อ HINO ISUZU",
    intentPartType: "อะไหล่แอร์",
    intentCarModel: "สิบล้อ HINO, ISUZU",
    intentPartKind: "fitment",
  });
  dependencies.correctPartSpelling = async () => ({
    original: "แอรื",
    corrected: "แอร์",
  });
  dependencies.resolveChatFitmentFilters = async (filterInput) => ({
    categoryName: filterInput.partType === "แอร์" ? "คอมแอร์ (Compressor)" : undefined,
  });

  const result = await processLineWebhookPayload(
    textPayload("มีอะไหล่แอรื สิบล้อ HINO ISUZU บ้างไหมค่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "must not search broad aircon/truck text");
  assert.ok(calls.replies[0]?.text.includes("แอดมิน"), "June-style admin handoff reply");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "uncertain turn goes straight to admin");
  assert.equal(calls.notifyHandoffs.length, 1);
  assert.deepEqual(calls.savedFrames, [], "broad non-specific frame must not be persisted");
  assert.ok(!calls.auditActions.includes("CATEGORY_LLM_FALLBACK"), "must not map generic aircon to compressor");
});

test("broad stored frame plus price/photo follow-up hands off without re-searching", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: {
      partType: "อะไหล่แอร์",
      carModel: "สิบล้อ HINO, ISUZU",
    },
    nonProductTurn: true,
    intentGroup: "price_negotiation",
  });

  const result = await processLineWebhookPayload(
    textPayload("มีรูปพร้อมราคาให้ไหมค่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "follow-up must not resurrect broad frame into search");
  assert.ok(calls.replies[0]?.text.includes("แอดมิน"));
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
});

test("gate: fitment part + car (no year) searches and appends the year follow-up bubble", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ D-Max",
    intentPartType: "หม้อน้ำ",
    intentCarModel: "D-Max",
    intentPartKind: "fitment",
  });
  // Search returns ids; provide matching summaries so flex cards (and thus the
  // follow-up bubble) are produced.
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "หม้อน้ำ D-Max", code: "P1", imageUrl: null, salePrice: 1500, retailPrice: 1500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("หม้อน้ำ D-Max"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1, "search runs (rule #1)");
  const reply = calls.replies[0];
  assert.ok(reply, "a reply was sent");
  // [text, (flex), follow-up] — flex cards need a storefront base URL (absent in
  // tests), so here it's [text, follow-up]. The year nudge is always the LAST
  // bubble, sent after the matches.
  assert.ok((reply?.messageCount ?? 0) >= 2, "at least the reply + follow-up bubble");
  assert.ok(reply?.texts.at(-1)?.includes("ปีรถ"), "last bubble nudges for the model year");
});

test("direct no-match with part + car replies once and hands off to admin", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "แผงแอร์ Toyota Tiger",
    intentPartType: "แผงแอร์",
    intentCarBrand: "Toyota",
    intentCarModel: "Tiger",
    intentPartKind: "fitment",
    fitmentFilters: {
      categoryName: "คอยล์ร้อน (Condenser)",
      carBrandName: "Toyota",
      carModelName: "Tiger",
    },
    searchTotal: 0,
    searchIds: [],
    failedSearchCount: 0,
    faqReply: "FAQ should not answer this no-match product search",
  });

  const result = await processLineWebhookPayload(
    textPayload("แผงแอร์ tigerp"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1);
  assert.equal(calls.replies.length, 1);
  assert.ok(calls.replies[0]?.text.includes("ยังไม่มีรายการนี้ในระบบโดยตรง"));
  assert.ok(calls.replies[0]?.text.includes("แผงแอร์"), "part-aware: names the requested part");
  assert.ok(calls.replies[0]?.text.includes("ส่งต่อให้แอดมิน"));
  assert.ok(!calls.replies[0]?.text.includes("FAQ should not answer"));
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "AI pauses and waits for admin");
  assert.equal(calls.notifyHandoffs.length, 1, "admin is notified once");
  assert.ok(calls.auditActions.includes("AI_DIRECT_NO_MATCH_HANDOFF"));
});

test("specific part with no category that anchors to zero hands off (even without a car)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "เทอร์โมสตรัท Vios 2017",
    intentPartType: "เทอร์โมสตรัท",
    intentCarBrand: "Toyota",
    intentCarModel: "Vios",
    intentPartKind: "fitment",
    // No category resolves for a thermostat → the fitment-part anchor engages and
    // the stub returns SEARCHED_FITMENT_PART_NO_MATCH for total 0.
    fitmentFilters: { carBrandName: "Toyota", carModelName: "Vios" },
    searchTotal: 0,
    searchIds: [],
    failedSearchCount: 0,
  });

  const result = await processLineWebhookPayload(
    textPayload("เช็ค เทอร์โมสตรัท Vios ปี2017 ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.replies[0]?.text.includes("เทอร์โมสตรัท"), "acknowledges the requested part");
  assert.ok(calls.replies[0]?.text.includes("ยังไม่มีรายการนี้ในระบบโดยตรง"));
  assert.ok(calls.replies[0]?.text.includes("ส่งต่อให้แอดมิน"));
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "AI pauses and waits for admin");
  assert.equal(calls.notifyHandoffs.length, 1, "admin is notified once");
  assert.ok(calls.auditActions.includes("AI_DIRECT_NO_MATCH_HANDOFF"));
});

test("price inquiry with a searchable part → searches, shows products, then hands price off to admin", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ d-max",
    intentPartType: "หม้อน้ำ",
    intentCarModel: "D-Max",
    intentPartKind: "universal", // searchable directly; focus is the price path
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "หม้อน้ำ D-Max", code: "P0496", imageUrl: null, salePrice: 1500, retailPrice: 1500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("หม้อน้ำ d-max ราคาเท่าไหร่ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1, "price question still searches the catalog");
  // No PURCHASE_HANDOFF — the customer sees products first, not a bare purchase handoff.
  assert.ok(!calls.replies[0]?.text.includes("เดี๋ยวแอดมินมาช่วยสรุปราคาและการจัดส่ง"));
  // ถามราคา → ส่งเรื่องให้แอดมินทุกกรณี: โชว์การ์ดก่อน แล้วต่อ note ส่งเรื่องราคา + freeze
  assert.ok(calls.replies[0]?.texts.at(-1)?.includes("ส่งเรื่องให้แอดมิน"), "price handed off to admin as a note");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "room frozen for admin to quote price");
});

test("retail-tier customer naming a product + price → shows cards then hands off to admin", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "RETAIL", // ลูกค้าทั่วไป/unlinked — เห็นราคาขายปลีก
    consolidatedQuery: "คอยเย็นวีโก้",
    intentPartType: "คอยล์เย็น", // ข้อความระบุสินค้าเอง → โชว์การ์ดก่อน handoff
    intentCarModel: "Vigo",
    intentPartKind: "universal",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "คอยล์เย็น Toyota Vigo", code: "P0038", imageUrl: null, salePrice: 1500, retailPrice: 1500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("คอยเย็นวีโก้ เท่าไรครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1, "searches so the customer sees what's in stock");
  // Product answer bubble + handoff note (flex needs a base URL, absent in tests → 2 bubbles).
  assert.ok((calls.replies[0]?.messageCount ?? 0) >= 2, "product answer + handoff note");
  assert.ok(calls.replies[0]?.texts.at(-1)?.includes("ส่งเรื่องให้แอดมิน"), "handoff note after the matches");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "room frozen for admin to quote price");
  assert.equal(calls.notifyHandoffs.length, 1, "admin notified once");
});

test("bare price question (no product named) → direct handoff, no cards re-shown", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "RETAIL",
    // No intentPartType/car — the message names no product; the search only finds
    // items via carried context. This is the "ราคาเท่าไร" follow-up after a list was shown.
    consolidatedQuery: "ราคาเท่าไร",
    intentPartKind: "universal",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "แผงแอร์ Honda Jazz", code: "P0073", imageUrl: null, salePrice: 1500, retailPrice: 1500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("ราคาเท่าไร"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "bare price follow-up must not re-search old product context");
  assert.equal(calls.replies[0]?.messageCount, 1, "only the handoff bubble, no cards/list re-shown");
  assert.ok(calls.replies[0]?.text.includes("แจ้งราคา"), "defers price to admin");
  assert.ok(!calls.replies[0]?.text.includes("P0073"), "does not repeat the product list");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "room frozen for admin");
  assert.equal(calls.notifyHandoffs.length, 1, "admin notified once");
  assert.ok(calls.auditActions.includes("AI_PRICE_HIDDEN_HANDOFF"));
});

test("coalesced multi-product price ask searches each product subject before handing price to admin", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "RETAIL",
    // Simulates Gemini unavailable / classifier timeout: deterministic fallback
    // must still detect the product subjects from the customer's own text.
  });

  const result = await processLineWebhookPayload(
    textPayload(
      [
        "ตู้วีโก้คลูเกีรยคับน้ำDENSO250ccราคาคับ",
        "น้ำมัน",
        "ที่ร้านมีน้ำยาแอร์ของอะไรคับขอราคาด้วยคับ",
      ].join("\n"),
    ),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 3, "searches the three customer-requested subjects");
  assert.ok(calls.searches.some((q) => q.includes("Vigo") || q.includes("วีโก้")), "searches the Vigo evaporator/cooling unit subject");
  assert.ok(calls.searches.some((q) => q.includes("DENSO") || q.includes("denso")), "searches the DENSO oil subject");
  assert.ok(calls.searches.some((q) => q.includes("น้ำยาแอร์")), "searches the refrigerant subject");
  assert.ok(calls.auditActions.includes("AI_MULTI_SUBJECT"));
  assert.ok(!calls.auditActions.includes("SEARCH_SKIPPED_NON_PRODUCT"));
});

test("bare price question with stored product frame stays a direct handoff", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "RETAIL",
    storedFrame: {
      partType: "แผงแอร์",
      carBrand: "Honda",
      carModel: "Jazz",
      year: 2012,
    },
  });

  const result = await processLineWebhookPayload(
    textPayload("ราคาเท่าไรครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "price-only text must not resurrect the stored frame");
  assert.equal(calls.replies[0]?.messageCount, 1);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
});

test("wholesale-tier customer (garage) asking price → shows products then hands off to admin too", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "WHOLESALE", // อู่ซ่อมรถ — เห็นราคาขายส่ง แต่เรื่องราคายังส่งแอดมินทุกกรณี
    consolidatedQuery: "หม้อน้ำ d-max",
    intentPartType: "หม้อน้ำ",
    intentCarModel: "D-Max",
    intentPartKind: "universal",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "หม้อน้ำ D-Max", code: "P0496", imageUrl: null, salePrice: 1500, retailPrice: 1500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("หม้อน้ำ d-max ราคาเท่าไหร่ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok((calls.replies[0]?.messageCount ?? 0) >= 2, "product answer + handoff note");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "price ask escalates for every tier");
  assert.equal(calls.notifyHandoffs.length, 1, "admin notified once");
});

test("genuine purchase intent still hands off to admin", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    nonProductTurn: true,
    intentGroup: "purchase",
  });

  const result = await processLineWebhookPayload(
    textPayload("เอาตัวนี้ครับ สั่งเลย"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.replies[0]?.text.includes("แอดมิน"), "purchase commitment routes to a human");
  assert.equal(calls.searches.length, 0);
});

test("noise text ('...') stays silent — never searches or resurrects old history", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // consolidatedQuery is set to simulate the classifier WANTING to pull old context;
  // the noise gate must short-circuit before the classifier/search ever run.
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ d max ปี 2003",
    intentPartType: "หม้อน้ำ",
    intentCarModel: "D-Max",
    intentPartKind: "fitment",
  });

  const result = await processLineWebhookPayload(
    textPayload("..."),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 0, "no reply for noise");
  assert.equal(calls.searches.length, 0, "no product search");
  assert.equal(calls.replies.length, 0);
  assert.ok(calls.auditActions.includes("NOISE_IGNORED"));
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"), "AI stays active");
});

test("real text with digits/letters is NOT treated as noise", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ d max",
    intentPartKind: "universal",
  });

  await processLineWebhookPayload(
    textPayload("ปี 03"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.ok(!calls.auditActions.includes("NOISE_IGNORED"), "'ปี 03' is meaningful");
  assert.equal(calls.searches.length, 1, "still searches a real follow-up");
});

test("inquiry frame: a sparse follow-up ('ปี 03') continues the stored subject, doesn't ask for the car", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "หม้อน้ำ", carModel: "D-Max" },
    // latest message carries ONLY the year (no part/car of its own)
    consolidatedQuery: "ปี 03",
    intentPartType: null,
    intentCarModel: null,
    intentYear: 2003,
    intentPartKind: "fitment",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "หม้อน้ำ D-Max 2003", code: "P1", imageUrl: null, salePrice: 1500, retailPrice: 1500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("ปี 03"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1, "searches using the carried frame (part+car+year)");
  assert.ok(!calls.replies[0]?.text.includes("ยี่ห้อ"), "does NOT ask for the car again");
  // The frame was merged: part + car kept, year filled.
  assert.deepEqual(calls.savedFrames.at(-1), {
    partType: "หม้อน้ำ",
    carBrand: null,
    carModel: "D-Max",
    year: 2003,
  });
});

test("inquiry frame: a new part type is a topic shift — query rebuilt from the new subject", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "หม้อน้ำ", carModel: "D-Max", year: 2003 },
    consolidatedQuery: "หม้อน้ำ d max ปี 2003", // classifier's stale history-merged query
    intentPartType: "คอยล์เย็น",
    intentCarModel: null,
    intentPartKind: "fitment",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "คอยล์เย็น D-Max", code: "P2", imageUrl: null, salePrice: 900, retailPrice: 900 },
  ];

  await processLineWebhookPayload(
    textPayload("คอยล์เย็น"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1);
  const q = calls.searches[0] ?? "";
  assert.ok(q.includes("คอยล์เย็น"), "query is the new subject");
  assert.ok(!q.includes("หม้อน้ำ"), "stale old part dropped from the query");
  // Frame: part replaced, vehicle kept.
  assert.equal(calls.savedFrames.at(-1)?.partType, "คอยล์เย็น");
  assert.equal(calls.savedFrames.at(-1)?.carModel, "D-Max");
});

test("inquiry frame: a hallucinated part type on a vehicle-only follow-up is NOT a topic shift (Option A grounding)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    // The valve part was established from the customer's image on a previous turn.
    storedFrame: { partType: "วาล์วแอร์", carBrand: "Toyota", carModel: "Vios" },
    // Classifier hallucinates a common AC part for a car-only follow-up.
    consolidatedQuery: "คอยล์เย็น Toyota Vios",
    intentPartType: "คอยล์เย็น",
    intentCarBrand: "Toyota",
    intentCarModel: "Vios",
    intentYear: 2013,
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "วาล์ว (Expansion Valve)", carBrandName: "Toyota", carModelName: "Vios" },
  });

  await processLineWebhookPayload(
    textPayload("Vios gen3 ปี2013ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  // The customer only supplied car + year (no part word, no new image), so the
  // classifier's ungrounded "คอยล์เย็น" must not override the image-established
  // valve — the frame keeps "วาล์วแอร์".
  assert.equal(calls.savedFrames.at(-1)?.partType, "วาล์วแอร์");
  assert.equal(calls.savedFrames.at(-1)?.carModel, "Vios");
});

test("product-code fast-path: a part image with a catalog-resolvable OCR code still honors fitment filters first", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imagePartType: "วาล์วแอร์", // part-only → the gate would normally ask for the car
    imagePartKind: "fitment",
    imageCarBrand: "Toyota",
    imageCarModel: "Vios",
    imagePartNumber: "DI261411-0300",
    imageHints: ["วาล์วแอร์", "Toyota Vios 13-19"],
    catalogCodes: ["di261411-0300"], // exists in the catalog (resolves)
    fitmentFilters: {
      categoryName: "Expansion Valve",
      carBrandName: "Toyota",
      carModelName: "Vios",
    },
  });

  await processLineWebhookPayload(
    imagePayload("event-img-code"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  // Fitment evidence from the current turn wins over exact-code lookup.
  assert.equal(calls.searches.length, 1, "image still searches");
  assert.notEqual(calls.searches.at(-1), "di261411-0300", "fitment search must not be hijacked by direct code");
  assert.deepEqual(calls.searchFitmentHints.at(-1), {
    categoryName: "Expansion Valve",
    carBrandName: "Toyota",
    carModelName: "Vios",
    fitmentYear: null,
  });
  assert.ok(!calls.auditActions.includes("PRODUCT_CODE_DIRECT"));
});

test("product-code fast-path: an unknown OCR code falls back to the normal (ask/search) flow", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imagePartType: "วาล์วแอร์",
    imagePartKind: "fitment",
    imagePartNumber: "ZZ999-0000",
    catalogCodes: [], // resolves to nothing → not a real code
  });

  await processLineWebhookPayload(
    imagePayload("event-img-nocode"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  // No resolvable code → part-only image still asks for the car (legacy behaviour).
  assert.equal(calls.searches.length, 0, "no code → gate still asks for the car");
});

test("product-code fast-path: a customer-typed code searches by that exact code", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "สอบถามราคา P0368",
    intentPartType: null,
    intentCarBrand: null,
    intentCarModel: null,
    intentYear: null,
    catalogCodes: ["p0368"],
  });

  await processLineWebhookPayload(
    textPayload("สอบถามราคา P0368"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1);
  assert.equal(calls.searches.at(-1), "p0368", "the resolved code drives the exact-code search");
  assert.equal(calls.searchFitmentHints.at(-1), null);
});

test("fitment-first search: category/model filters block numeric-only code hijack", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "ac hose Strada 2500",
    intentPartType: "ac hose",
    intentCarBrand: null,
    intentCarModel: "Strada",
    intentPartKind: "fitment",
    catalogCodes: ["2500"],
    fitmentFilters: {
      categoryName: "A/C Hose",
      carBrandName: undefined,
      carModelName: "Strada",
    },
  });

  await processLineWebhookPayload(
    textPayload("ac hose Strada 2500"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1);
  assert.notEqual(calls.searches.at(-1), "2500", "numeric model token must not trigger direct code search");
  assert.deepEqual(calls.searchFitmentHints.at(-1), {
    categoryName: "A/C Hose",
    carBrandName: null,
    carModelName: "Strada",
    fitmentYear: null,
  });
  assert.ok(!calls.auditActions.includes("PRODUCT_CODE_DIRECT"));
});

test("inquiry frame: spec-only latest text drops stale vehicle hard filters", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "compressor", carBrand: "Honda", carModel: "Civic", year: 2010 },
    consolidatedQuery: "24v",
    intentPartType: null,
    intentCarBrand: null,
    intentCarModel: null,
    intentYear: null,
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "Compressor", carBrandName: "Honda", carModelName: "Civic" },
  });

  await processLineWebhookPayload(
    textPayload("24v"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "spec token searches instead of asking for car");
  assert.deepEqual(calls.savedFrames.at(-1), {
    partType: "compressor",
    carBrand: null,
    carModel: null,
    year: null,
  });
  assert.deepEqual(calls.searchFitmentHints.at(-1), {
    categoryName: "Compressor",
    carBrandName: null,
    carModelName: null,
    fitmentYear: null,
  });
});

test("inquiry frame: part-image OCR hints drop stale vehicle hard filters", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "compressor", carBrand: "Honda", carModel: "Civic" },
    imageKind: "part_image",
    imageHints: ["Valeo Z0016525A", "compressor 24v"],
    imagePartType: "compressor",
    imagePartKind: "fitment",
    fitmentFilters: { categoryName: "Compressor", carBrandName: "Honda", carModelName: "Civic" },
  });

  await processLineWebhookPayload(
    imagePayload("event-img-frame-reset"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "image hints search instead of being blocked by need_car");
  assert.deepEqual(calls.savedFrames.at(-1), {
    partType: "compressor",
    carBrand: null,
    carModel: null,
    year: null,
  });
  assert.deepEqual(calls.searchFitmentHints.at(-1), {
    categoryName: "Compressor",
    carBrandName: null,
    carModelName: null,
    fitmentYear: null,
  });
});

test("inquiry frame: new fitment part image keeps the freshly answered vehicle", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "แผงแอร์", carBrand: "Isuzu", carModel: "D-Max" },
    imageKind: "part_image",
    imageHints: ["พัดลมโบลเวอร์", "blower motor", "62500 30352"],
    imagePartType: "พัดลมโบลเวอร์",
    imagePartKind: "fitment",
    fitmentFilters: {
      categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)",
      carBrandName: "Isuzu",
      carModelName: "D-Max",
    },
  });

  await processLineWebhookPayload(
    imagePayload("event-img-keep-fresh-vehicle"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "new part image still searches");
  assert.deepEqual(calls.savedFrames.at(-1), {
    partType: "พัดลมโบลเวอร์",
    carBrand: "Isuzu",
    carModel: "D-Max",
    year: null,
  });
  assert.deepEqual(calls.searchFitmentHints.at(-1), {
    categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)",
    carBrandName: "Isuzu",
    carModelName: "D-Max",
    fitmentYear: null,
  });
});

test("inquiry frame: generic part image drops stale vehicle but still asks for car", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "radiator", carBrand: "Honda", carModel: "Civic" },
    imageKind: "part_image",
    imageHints: ["radiator"],
    imagePartType: "radiator",
    imagePartKind: "fitment",
    fitmentFilters: { categoryName: "Radiator", carBrandName: "Honda", carModelName: "Civic" },
  });

  await processLineWebhookPayload(
    imagePayload("event-img-generic-frame-reset"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  assert.deepEqual(calls.searches, [], "generic image does not search without a current car");
  assert.deepEqual(calls.savedFrames.at(-1), {
    partType: "radiator",
    carBrand: null,
    carModel: null,
    year: null,
  });
  assert.match(calls.replies[0]?.text ?? "", /รถ|รุ่น|ยี่ห้อ|car/i);
});
