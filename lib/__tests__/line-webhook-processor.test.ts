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

// A product-turn classifier result. The shared default `extractChatSearchIntent`
// returns `null` (which the processor treats as a classify-failure → the
// classifier-uncertain hand-off). Tests that predate that guard and exercise the
// normal product / search / FAQ / escalation paths override the classifier with
// this so the turn is a resolved product turn instead of an uncertain hand-off.
const productSearchIntent = (query: string) => ({
  group: "product" as const,
  query,
  isProductQuery: true,
  partType: null,
  carBrand: null,
  carModel: null,
  year: null,
  partKind: "universal" as const,
  tooBroad: false,
});

// Deterministic AI reply so tests that reach the generation path don't depend on
// a real Gemini call (wording/latency). Used only where the assertion is about
// structure/routing, not the reply text.
const stubChatSuggestion = () => ({
  suggestedReply: "เจอสินค้าที่ตรงกับที่แจ้งค่ะ 😊",
  confidence: LineAiConfidence.POSSIBLE_MATCH,
  reasoningSummary: "TEST_STUB",
});

function createProcessorTestDeps(input?: {
  duplicate?: boolean;
  duplicateEventIds?: string[];
  conversationStatus?: LineConversationAiStatus;
  linkedCustomerId?: string | null;
  priceTier?: "UNLINKED" | "RETAIL" | "WHOLESALE";
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
  /** Per-id match reasons the stubbed engine returns (relevance-gate signal).
   *  Defaults to a strong "name" match for every id so normal cases show cards. */
  searchMatchReasons?: Record<string, string[]>;
  /** Ids the stubbed engine flags as a close (>= strong) trigram near-match. */
  searchHighTrigramIds?: string[];
  /** Override the stubbed search reason (e.g. SEARCHED_ACCESSORY_HEAD_FALLBACK). */
  searchReason?: string;
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
  /** The customer's own words for the vehicle in the latest message, as reported
   *  by the classifier (null = the latest message names no vehicle). */
  intentCarMentionInLatest?: string | null;
  storedFrame?: {
    partType?: string | null;
    carBrand?: string | null;
    carModel?: string | null;
    year?: number | null;
  } | null;
  /** updatedAt for the stored frame; pass an old date to simulate a stale session. */
  storedFrameUpdatedAt?: Date;
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
  // Capture these BEFORE the search stub — its own `input` param shadows this
  // config `input`, so they must be read from the outer scope here.
  const configuredMatchReasons = input?.searchMatchReasons;
  const configuredHighTrigramIds = input?.searchHighTrigramIds ?? [];
  const configuredSearchReason = input?.searchReason;

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
        configuredSearchReason ??
        (input.fitmentPartHeadNoun && configuredSearchTotal === 0
          ? "SEARCHED_FITMENT_PART_NO_MATCH"
          : "SEARCHED_PRODUCT_INQUIRY");
      // Mirror the real engine, which always returns per-id match reasons. Default
      // to a strong "name" match so ordinary cases show cards; weak-match tests
      // override with empty reasons to exercise the category-less relevance gate.
      const stubMatchReasons =
        configuredMatchReasons ??
        Object.fromEntries(configuredSearchIds.map((id) => [id, ["name"]]));
      return {
        searched: true,
        reason: stubReason,
        query: input.text ?? "",
        result: {
          ids: configuredSearchIds,
          total: configuredSearchTotal,
          mode: "v2",
          matchReasons: stubMatchReasons,
          highTrigramProductIds: configuredHighTrigramIds,
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
        retailPrice: 1000, memberPrice: 1000,
      })),
    countConsecutiveFailedLineSearches: async () => input?.failedSearchCount ?? 0,
    countPendingPaymentSlipsForConversation: async () => 0,
    classifyPurchaseIntent: async () => input?.purchaseIntent ?? false,
    answerFromChatFaq: async () =>
      input?.faqReply ? { answered: true, reply: input.faqReply } : { answered: false, reply: "" },
    getPublicSiteConfig: async () => ({
      shopName: "ศรีวรรณ อะไหล่แอร์",
      shopPhone: "065-751-7873",
      shopPhoneSecondary: "",
      shopBusinessHours: "จันทร์ - อาทิตย์ 08:30 - 18:00 น.",
      shopGoogleMapUrl: "https://maps.example.test/shop",
    }) as Awaited<ReturnType<NonNullable<LineWebhookProcessorDependencies["getPublicSiteConfig"]>>>,
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
            carMentionInLatest: input?.intentCarMentionInLatest ?? null,
            year: input?.intentYear ?? null,
            // Default to universal so existing search-path tests still search
            // (the gate only blocks incomplete fitment turns).
            partKind: input?.intentPartKind ?? ("universal" as const),
            tooBroad: input?.intentTooBroad ?? false,
          }
        : null,
    // Hermetic default: production DB category mapping is covered by the focused
    // resolver/property tests. Explicit LLM subjects still exercise this suite's
    // existing multi-subject paths; mapping-specific cases override this stub.
    detectChatMultiSubjects: async ({ intent }) => ({
      subjects: intent?.subjects && intent.subjects.length >= 2 ? intent.subjects : null,
      source: intent?.subjects && intent.subjects.length >= 2 ? "llm" : "none",
      handoffReason: null,
      categories: [],
    }),
    getLineInquiryFrame: async () =>
      input?.storedFrame
        ? {
            partType: input.storedFrame.partType ?? null,
            carBrand: input.storedFrame.carBrand ?? null,
            carModel: input.storedFrame.carModel ?? null,
            year: input.storedFrame.year ?? null,
            updatedAt: input.storedFrameUpdatedAt ?? new Date(), // fresh → same session (unless overridden)
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
    // Hermetic: never touch the DB for model synonyms either (guard falls back to
    // English-only model evidence).
    loadCarModelVariantLookup: async () => new Map<string, string[]>(),
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
  // Normal product turn with a deterministic reply (see helper notes).
  dependencies.extractChatSearchIntent = async () => productSearchIntent("vios 1234");
  dependencies.generateChatSuggestion = async () => stubChatSuggestion();

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
  assert.match(calls.replies[0]?.text ?? "", /จูน.*แอดมิน.*แชตนี้/);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
});

test("shipping questions use June-style admin handoff and never call FAQ or product search", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  let faqCalls = 0;
  const { calls, dependencies } = createProcessorTestDeps();
  dependencies.answerFromChatFaq = async () => {
    faqCalls += 1;
    return { answered: true, reply: "FAQ must not answer shipping" };
  };

  const result = await processLineWebhookPayload(
    textPayload("ค่าจัดส่งเท่าไร ส่งต่างจังหวัดไหม"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(faqCalls, 0);
  assert.deepEqual(calls.searches, []);
  assert.match(calls.replies[0]?.text ?? "", /เรื่องค่าจัดส่งหรือการจัดส่ง.*จูน.*แอดมิน.*แชตนี้/);
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

test("general non-product turn uses grounded FAQ without product search or handoff", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // A general question the keyword router didn't catch as SHOP_INFO may use the
  // separately grounded knowledge corpus, but must never enter catalog search.
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
  assert.equal(calls.replies[0]?.text, "ร้านศรีวรรณอยู่ปทุมธานีค่ะ 🙏");
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

test("shop_info group answers from current site config, no search", async () => {
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
  // A resolved product turn ("vios" locks to a hard fitment filter — otherwise the
  // vehicle-unresolved guard fires) whose reply generation never returns in time.
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "คอยล์เย็น vios",
    intentPartType: "คอยล์เย็น",
    intentCarModel: "Vios",
    intentPartKind: "fitment",
    fitmentFilters: { carModelName: "Vios" },
  });
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
    fitmentFilters: { carModelName: "D-Max" },
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
  // "AI consolidation declines" = the classifier ran (product turn) but echoed the
  // raw text instead of rewriting it into a different consolidated query, so search
  // runs on the latest text. Returning the raw text (not a null intent) keeps it a
  // product turn instead of tripping the uncertain hand-off.
  dependencies.extractChatSearchIntent = async () => productSearchIntent("คอยเย็น vios");
  dependencies.generateChatSuggestion = async () => stubChatSuggestion();
  // Capture the consolidated-query audit payload (if any) to prove there was no
  // divergent rewrite — the ungrounded query is force-literalled to the raw text.
  let consolidatedQueryLogged: string | null = null;
  const basePushAudit = dependencies.storeLineAiAudit!;
  dependencies.storeLineAiAudit = async (a) => {
    if (a.action === "SEARCH_QUERY_CONSOLIDATED") {
      consolidatedQueryLogged = String(
        (a.payload as { consolidatedQuery?: unknown } | undefined)?.consolidatedQuery ?? "",
      );
    }
    return basePushAudit(a);
  };

  const result = await processLineWebhookPayload(
    textPayload("คอยเย็น vios"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.processedCount, 1);
  assert.deepEqual(calls.searches, ["คอยเย็น vios"]);
  // The classifier declined to rewrite, so the query used is the raw latest text —
  // either no consolidation, or a literal fallback equal to it — never a divergent
  // rewritten query.
  assert.equal(consolidatedQueryLogged ?? "คอยเย็น vios", "คอยเย็น vios");
});

test("an executed product search with no match always hands off and suppresses FAQ", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ faqReply: "ร้านส่งต่างจังหวัดได้ค่ะ 🙏" });
  // Resolved product turn whose search comes back empty must never be converted
  // into a FAQ answer; the confirmed policy is human handoff for every no-match.
  dependencies.extractChatSearchIntent = async () => productSearchIntent("asdf qwer");
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
  assert.match(calls.replies[0]?.text ?? "", /แอดมิน/);
  assert.ok(!(calls.replies[0]?.text ?? "").includes("ส่งต่างจังหวัด"));
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
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

test("an empty search escalates to admin (waiting + notify + send-off message)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ failedSearchCount: 2 });
  // Resolved product turn (not a null/uncertain classification) so the repeated
  // empty-search escalation is what fires — not the classifier-uncertain hand-off.
  dependencies.extractChatSearchIntent = async () => productSearchIntent("vios 1234");
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
  assert.match(calls.replies[0]?.text ?? "", /ส่งเรื่องให้แอดมิน/);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  // The counter-based escalation (`AI_ESCALATE_NO_RESULTS`, which this test was
  // originally written for) now sits BEHIND `anySearchedNoMatch` in the hand-off
  // chain, and `failedSearchCount` is only counted on a turn that searched and got
  // zero — the exact condition that makes `anySearchedNoMatch` true. So the no-match
  // branch always wins first. Customer-visible behaviour is identical (same message,
  // same freeze, same notify); only the audit label differs.
  assert.ok(calls.auditActions.includes("AI_SEARCH_NO_MATCH_HANDOFF"));
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

test("quotation request hands off to admin without asking for vehicle details", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();

  const result = await processLineWebhookPayload(
    textPayload("ทำใบเสนอราคามาให้หน่อยได้ไหมคะ ต้องการ 15 อัน"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.match(calls.replies[0]?.text ?? "", /ส่งคำขอใบเสนอราคาให้แอดมิน/);
  assert.doesNotMatch(calls.replies[0]?.text ?? "", /ยี่ห้อ|รุ่นรถ/);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.ok(calls.auditActions.includes("AI_QUOTATION_REQUEST_HANDOFF"));
  assert.equal(calls.notifyHandoffs.length, 1);
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

test("G1: broad NEW ask after a specific turn hands off — a carried specific part must not mask it", async () => {
  // Regression (conv cmq4ziq6l): the prior turn was a specific "สายแอร์ สตาด้า" query,
  // so the frame carries partType "สายแอร์". THIS turn the customer asks broadly
  // ("อะไหล่แอร์ สิบล้อ HINO ISUZU") and the classifier returns no partType, so the
  // frame keeps "สายแอร์" (not broad) → the frame-based gate would search and answer
  // with carried A/C-hose D-Max results. G1 reads the customer's actual broad text and
  // forces the BROAD_PART_TYPE hand-off instead.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "สายแอร์", carModel: "Strada" },
    consolidatedQuery: "อะไหล่แอร์ สิบล้อ HINO ISUZU",
    // Classifier reads no specific part this turn → frame keeps the carried "สายแอร์".
    intentCarModel: "สิบล้อ HINO, ISUZU",
    fitmentFilters: { categoryName: "สายน้ำยา (A/C Hose)" },
  });
  // If the guard ever reached search, it would return these — the test proves it does NOT.
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "สายน้ำยาแอร์ Isuzu D-Max", code: "P0837", imageUrl: null, salePrice: 350, retailPrice: 350, memberPrice: 350 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("มีอะไหล่แอรื สิบล้อ HINO ISUZU บ้างไหมค่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "broad NEW ask must not search (carried part must not mask it)");
  assert.ok(!calls.replies[0]?.text.includes("D-Max"), "does not answer with carried wrong-vehicle results");
  assert.ok(calls.replies[0]?.text.includes("แอดมิน"), "hands off to admin");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
});

test("G2: switching to a vehicle CLASS (no new part, no connective) drops the carried part → asks which part", async () => {
  // After "สายแอร์ Strada", the customer asks about a truck class with no specific
  // part and no continuation word: "มีของ Hino สิบล้อไหม". The carried "สายแอร์" must
  // NOT hard-filter this class inquiry to A/C hoses — G2 drops it so the gate asks
  // which part instead. (Not broad text, so G1 does not fire here.)
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "สายแอร์", carModel: "Strada" },
    consolidatedQuery: "Hino สิบล้อ",
    // Classifier reads a car but NO part this turn (a class-only ask is not a
    // universal accessory).
    intentCarModel: "สิบล้อ",
    intentPartKind: "fitment",
  });

  const result = await processLineWebhookPayload(
    textPayload("มีของ Hino สิบล้อไหม"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "carried part dropped → no search on the old category");
  const framed = calls.savedFrames.at(-1);
  assert.equal(framed?.partType ?? null, null, "carried สายแอร์ is dropped on the class switch");
});

test("G2: a continuation ('แล้ว…ล่ะ') keeps the carried part even if it names a class", async () => {
  // "แล้วสิบล้อ Hino ล่ะ" is a follow-up — the carried "สายแอร์" MUST stay so the
  // search continues the same part on the new vehicle (owner's rule: connective
  // continuations keep the frame; broadness would still win, but this isn't broad).
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "สายแอร์", carModel: "Strada" },
    consolidatedQuery: "สายแอร์ สิบล้อ Hino",
    intentCarModel: "สิบล้อ",
    fitmentFilters: { categoryName: "สายน้ำยา (A/C Hose)" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "สายน้ำยาแอร์ Hino", code: "P1", imageUrl: null, salePrice: 500, retailPrice: 500, memberPrice: 500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("แล้วสิบล้อ Hino ล่ะ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  const framed = calls.savedFrames.at(-1);
  assert.equal(framed?.partType, "สายแอร์", "continuation keeps the carried part");
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
    fitmentFilters: { carModelName: "D-Max" },
  });
  // Search returns ids; provide matching summaries so flex cards (and thus the
  // follow-up bubble) are produced.
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "หม้อน้ำ D-Max", code: "P1", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
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
  assert.ok(calls.replies[0]?.text.includes("ช่วยเช็กสต็อกและตัวที่เข้ากันให้ชัวร์"));
  assert.ok(calls.replies[0]?.text.includes("แผงแอร์"), "part-aware: names the requested part");
  assert.ok(calls.replies[0]?.text.includes("ให้แอดมิน"));
  assert.ok(!calls.replies[0]?.text.includes("FAQ should not answer"));
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "AI pauses and waits for admin");
  assert.equal(calls.notifyHandoffs.length, 1, "admin is notified once");
  assert.ok(calls.auditActions.includes("AI_DIRECT_NO_MATCH_HANDOFF"));
});

test("พัดลมเป่า 14 นิ้ว searches Cooling Fan Blade then uses the safe shared handoff copy", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "พัดลมเป่า 14 นิ้ว",
    intentPartType: "พัดลม",
    // Regression guard: even when the classifier calls a bare fan a fitment part,
    // the explicit inch/push context makes it a searchable universal fan.
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "ใบพัดลม (Cooling Fan Blade)" },
    searchTotal: 0,
    searchIds: [],
    searchReason: "SEARCHED_PRODUCT_SPEC_NO_MATCH",
    failedSearchCount: 0,
  });

  const result = await processLineWebhookPayload(
    textPayload("พัดลมเป่า 14นิ้วมีไหมคับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1, "the universal fan query is searched before handoff");
  assert.equal(calls.searchFitmentHints[0]?.categoryName, "ใบพัดลม (Cooling Fan Blade)");
  assert.match(calls.replies[0]?.text ?? "", /สำหรับพัดลม แบบเป่า 14 นิ้ว/);
  assert.match(calls.replies[0]?.text ?? "", /ให้แอดมินช่วยเช็กสต็อกและตัวที่เข้ากัน/);
  assert.doesNotMatch(
    calls.replies[0]?.text ?? "",
    /ไม่มีสินค้า|ไม่มีของ|หาไม่เจอ|ไม่พบสินค้า|ยังไม่พบ/,
  );
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.ok(calls.auditActions.includes("AI_DIRECT_NO_MATCH_HANDOFF"));
});

test("customer names a car we can't resolve → confirms vehicle + hands off, no unscoped cards (Strada case)", async () => {
  // "สายแอร์…สตาด้า2500": the model is grounded (customer really typed it) but does
  // NOT resolve to a hard fitment filter (no carModelName/carBrandName), while the
  // search still returns rows scoped only by category + the "2500" cc anchor. Those
  // rows are other vehicles' A/C hoses — showing them would be a confident mismatch.
  // Option A must suppress the cards, ask to confirm the vehicle, and hand off.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "สายแอร์ สตาด้า 2500",
    intentPartType: "สายแอร์",
    intentCarModel: "Strada",
    intentPartKind: "universal",
    // Category resolves (A/C Hose) but the model does NOT → carModelName omitted.
    fitmentFilters: { categoryName: "สายน้ำยา (A/C Hose)" },
  });
  // F: the synonym lookup grounds the Thai "สตาด้า" onto the English "Strada" so the
  // model survives the guard (in production this comes from the SearchSynonym table).
  dependencies.loadCarModelVariantLookup = async () =>
    new Map<string, string[]>([["strada", ["strada", "สตาด้า", "mitsubishi strada"]]]);
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "สายน้ำยาแอร์ Isuzu D-Max", code: "P0836", imageUrl: null, salePrice: 430, retailPrice: 430, memberPrice: 430 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("สายแอร์ใหญ่สตาด้า2500"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.auditActions.includes("AI_VEHICLE_UNRESOLVED_HANDOFF"), "vehicle-unresolved guard fires");
  assert.ok(calls.replies[0]?.text.includes("ยืนยัน"), "asks the customer to confirm the vehicle");
  // The other-model card (D-Max) must NOT be shown as a match.
  assert.ok(!calls.replies[0]?.text.includes("D-Max"), "does not present another vehicle's part");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "AI pauses and waits for admin");
  assert.equal(calls.notifyHandoffs.length, 1, "admin is notified once");
});

test("Option A: a named-but-unknown MODEL on a KNOWN brand hands off (does not show other models' parts — Honda Odyssey case)", async () => {
  // Production regression (LINE conv cmq6o1g1u, 2026-07-24): the customer named
  // "Odyssey" (grounded — really typed "ฮอนด้าออดิซี่") which is NOT in master data, so
  // it never resolved to a carModelName. The BRAND Honda DID resolve, so the old guard
  // (which also required !carBrandName) let a brand-only air-filter search through,
  // presenting Honda City/Jazz/Accord filters as if they fit an Odyssey. Option A must
  // now fire even though the brand resolved, suppress the cards, and confirm the vehicle.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "กรองอากาศ Honda Odyssey",
    intentPartType: "กรองอากาศ",
    intentCarBrand: "Honda",
    intentCarModel: "Odyssey",
    intentPartKind: "fitment",
    // Category + brand resolve, but the model does NOT → carModelName omitted.
    fitmentFilters: { categoryName: "กรองอากาศ (Air Filter)", carBrandName: "Honda" },
  });
  // Ground the Thai "ออดิซี่" onto the English "Odyssey" so the model survives to the
  // guard as grounded evidence (mirrors the SearchSynonym grounding in production).
  dependencies.loadCarModelVariantLookup = async () =>
    new Map<string, string[]>([["odyssey", ["odyssey", "ออดิซี่", "honda odyssey"]]]);
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "กรองอากาศ Honda City/Jazz", code: "P0794", imageUrl: null, salePrice: 250, retailPrice: 250, memberPrice: 250 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("ฮอนด้าออดิซี่"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.auditActions.includes("AI_VEHICLE_UNRESOLVED_HANDOFF"), "guard fires even though the brand resolved");
  assert.ok(calls.replies[0]?.text.includes("ยืนยัน"), "asks the customer to confirm the vehicle");
  assert.ok(!calls.replies[0]?.text.includes("P0794"), "does not present another Honda model's filter");
  assert.ok(!calls.replies[0]?.text.includes("City"), "does not present another Honda model's filter");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "AI pauses and waits for admin");
});

test("Option A: a bare BRAND with NO model named still searches brand scope (not blocked)", async () => {
  // Guardrail for the Option A change: when the customer names only a brand (no model),
  // guardedSearchIntent.carModel is null, so brand-only scope stays allowed — the guard
  // must NOT fire and the search still runs.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "กรองอากาศ Honda",
    intentPartType: "กรองอากาศ",
    intentCarBrand: "Honda",
    intentCarModel: null,
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "กรองอากาศ (Air Filter)", carBrandName: "Honda" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "กรองอากาศ Honda City/Jazz", code: "P0794", imageUrl: null, salePrice: 250, retailPrice: 250, memberPrice: 250 },
  ];

  await processLineWebhookPayload(
    textPayload("กรองอากาศ Honda"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "brand-only scope still searches");
  assert.ok(!calls.auditActions.includes("AI_VEHICLE_UNRESOLVED_HANDOFF"), "no model named → guard must not fire");
});

test("CR-V G3 resolves to CRV, searches, and suppresses only the opposite-side product", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const customerText = "มอเตอร์พัดลมหน้าเครื่องฝั่งคนขับ crv g3 2.0 มีของเลยไหมครับ";
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: customerText,
    intentPartType: "มอเตอร์พัดลมหน้าเครื่อง",
    intentCarBrand: "Honda",
    intentCarModel: "CR-V G3",
    intentPartKind: "fitment",
    searchIds: ["P0903", "P0270", "P0594"],
    searchTotal: 3,
  });
  dependencies.resolveChatFitmentFilters = async () => ({
    categoryName: "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)",
    carBrandName: "Honda",
    carModelName: "CRV",
    carModelOriginal: "CR-V G3",
    carModelQualifier: "g3",
    carModelResolutionSource: "search_synonym",
  });
  dependencies.generateChatSuggestion = async () => stubChatSuggestion();
  dependencies.getChatProductSummaries = async () => [
    {
      id: "P0903",
      name: "มอเตอร์พัดลม CRV G3 ฝั่งคนขับ",
      code: "P0903",
      imageUrl: null,
      salePrice: 1000,
      retailPrice: 1000, memberPrice: 1000,
      fitments: [{
        carBrandName: "Honda",
        carModelName: "CRV",
        submodel: null,
        engineSize: null,
        note: "CRV G3 07-12 ฝั่งคนขับ",
      }],
    },
    {
      id: "P0270",
      name: "มอเตอร์พัดลม CRV G3",
      code: "P0270",
      imageUrl: null,
      salePrice: 900,
      retailPrice: 900, memberPrice: 900,
      fitments: [{
        carBrandName: "Honda",
        carModelName: "CRV",
        submodel: null,
        engineSize: null,
        note: "CRV G3 07-12 ฝั่งคนนั่ง",
      }],
    },
    {
      id: "P0594",
      name: "มอเตอร์พัดลม CRV G3 ฝั่งคนนั่ง",
      code: "P0594",
      imageUrl: null,
      salePrice: 950,
      retailPrice: 950, memberPrice: 950,
      fitments: [{
        carBrandName: "Honda",
        carModelName: "CRV",
        submodel: null,
        engineSize: null,
        note: "CRV G3 07-12 ฝั่งคนนั่ง",
      }],
    },
  ];

  const result = await processLineWebhookPayload(
    textPayload(customerText),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.deepEqual(calls.searchFitmentHints.at(-1), {
    categoryName: "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)",
    carBrandName: "Honda",
    carModelName: "CRV",
    fitmentYear: null,
  });
  assert.ok(calls.auditActions.includes("AI_PRODUCT_CONFLICT_FILTER"));
  assert.ok(!calls.auditActions.includes("AI_VEHICLE_UNRESOLVED_HANDOFF"));
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 0);
  assert.match(calls.replies[0]?.text ?? "", /เครื่อง 2\.0/);
  assert.match(calls.replies[0]?.text ?? "", /เทียบรูปอะไหล่เดิม/);
  assert.doesNotMatch(calls.replies[0]?.text ?? "", /ยืนยันยี่ห้อ|ยืนยันรุ่นรถ/);
});

test("relevance gate: category-less + weak match (no strong reason, no close trigram) → hands off", async () => {
  // Customer gave part + car, the car RESOLVED (so the vehicle guard stays quiet),
  // but the part word never mapped to a category (categoryName=null) and the
  // returned row matched only weakly (empty reasons, not a close trigram). Showing
  // it would risk the wrong item → hand off instead ("ไม่มั่นใจอย่าตอบมั่ว").
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "เทอร์โมสตัท vios",
    intentPartType: "เทอร์โมสตัท",
    intentCarModel: "Vios",
    intentCarBrand: "Toyota",
    // Car resolves to a hard filter, category does NOT.
    fitmentFilters: { carBrandName: "Toyota", carModelName: "Vios" },
    searchMatchReasons: { "product-1": [] },
    searchHighTrigramIds: [],
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "สวิตช์ความร้อนหม้อน้ำ", code: "T9001", imageUrl: null, salePrice: 250, retailPrice: 250, memberPrice: 250 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("เทอร์โมสตัท vios"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.auditActions.includes("AI_WEAK_CATEGORY_MATCH_HANDOFF"), "weak-match guard fires");
  assert.ok(!calls.replies[0]?.text.includes("สวิตช์ความร้อน"), "does not show the weakly-matched part");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "AI pauses and waits for admin");
  assert.equal(calls.notifyHandoffs.length, 1, "admin is notified once");
});

test("relevance gate: category-less but a strong name match still shows cards", async () => {
  // Same category-less situation, but the returned row matches strongly on the
  // product's OWN name → it's trustworthy regardless of category (covers real
  // "อะไหล่อื่นๆ" items the shop actually stocks). Must show, not hand off.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "เทอร์โมสตัท vios",
    intentPartType: "เทอร์โมสตัท",
    intentCarModel: "Vios",
    intentCarBrand: "Toyota",
    fitmentFilters: { carBrandName: "Toyota", carModelName: "Vios" },
    searchMatchReasons: { "product-1": ["name"] },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "เทอร์โมสตัท Toyota Vios", code: "T9002", imageUrl: null, salePrice: 320, retailPrice: 320, memberPrice: 320 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("เทอร์โมสตัท vios"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(!calls.auditActions.includes("AI_WEAK_CATEGORY_MATCH_HANDOFF"), "weak-match guard does NOT fire");
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"), "AI stays active (not handed off)");
  assert.equal(calls.notifyHandoffs.length, 0, "no admin hand-off notification");
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
  assert.ok(calls.replies[0]?.text.includes("ช่วยเช็กสต็อกและตัวที่เข้ากันให้ชัวร์"));
  assert.ok(calls.replies[0]?.text.includes("ให้แอดมิน"));
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
    fitmentFilters: { carModelName: "D-Max" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "หม้อน้ำ D-Max", code: "P0496", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
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
    fitmentFilters: { carModelName: "Hilux Vigo" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "คอยล์เย็น Toyota Vigo", code: "P0038", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
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

test("unlinked customer sees retail price + a note that it is not the discounted price", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "UNLINKED", // ยังไม่ผูกบัญชีกับระบบร้าน
    consolidatedQuery: "คอยเย็นวีโก้",
    intentPartType: "คอยล์เย็น",
    intentCarModel: "Vigo",
    intentPartKind: "universal",
    fitmentFilters: { carModelName: "Hilux Vigo" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "คอยล์เย็น Toyota Vigo", code: "P0038", imageUrl: null, salePrice: 900, retailPrice: 1500, memberPrice: 1200 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("คอยเย็นวีโก้มีไหมครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  // ข้อความแจ้งราคาพิเศษต้องเป็น bubble สุดท้ายเสมอ
  assert.ok(
    calls.replies[0]?.texts.at(-1)?.includes("ราคาพิเศษ"),
    "special-price note is the last bubble",
  );
  // ลูกค้าแค่ถามหาของ ไม่ได้ถามราคา → AI ต้องทำงานต่อ ห้าม freeze ห้องรอแอดมิน
  assert.ok(
    !calls.statePatchTypes.includes("waiting_admin"),
    "AI keeps working — an informational note must not freeze the room",
  );
  assert.equal(calls.notifyHandoffs.length, 0, "no admin ping for a plain product lookup");
});

test("linked customer gets no special-price note (price already matches their tier)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "WHOLESALE",
    consolidatedQuery: "คอยเย็นวีโก้",
    intentPartType: "คอยล์เย็น",
    intentCarModel: "Vigo",
    intentPartKind: "universal",
    fitmentFilters: { carModelName: "Hilux Vigo" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "คอยล์เย็น Toyota Vigo", code: "P0038", imageUrl: null, salePrice: 900, retailPrice: 1500, memberPrice: 1200 },
  ];

  await processLineWebhookPayload(
    textPayload("คอยเย็นวีโก้มีไหมครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.ok(
    !calls.replies[0]?.texts.some((text) => text.includes("ราคาพิเศษ")),
    "linked customer must not be told to wait for a special price",
  );
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
    { id: "product-1", name: "แผงแอร์ Honda Jazz", code: "P0073", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
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

test("bare stock-availability ask (regex backstop, part carried from history) → admin handoff, never asks for the car", async () => {
  // Mirrors the real incident: after earlier evaporator photos, the customer asks
  // "ที่ร้านมีของใช้ไหมคัฟ". The classifier consolidates the HISTORY subject
  // (คอยล์เย็น) but this message names nothing searchable — the availability ask
  // must go to an admin, not the gate's "รบกวนแจ้งยี่ห้อ/รุ่นรถ" question.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "คอยล์เย็น" },
    consolidatedQuery: "คอยล์เย็น",
    intentPartType: "คอยล์เย็น",
    intentPartKind: "fitment",
  });

  const result = await processLineWebhookPayload(
    textPayload("ที่ร้านมีของใช้ไหมคัฟ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "bare availability ask must not search");
  assert.ok(calls.replies[0]?.text.includes("เช็กของให้ชัวร์"), "defers stock to admin");
  assert.ok(!calls.replies[0]?.text.includes("รบกวนแจ้งยี่ห้อ/รุ่นรถ"), "never asks for the car");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "room frozen for admin");
  assert.equal(calls.notifyHandoffs.length, 1, "admin notified once");
  assert.ok(calls.auditActions.includes("AI_STOCK_AVAILABILITY_HANDOFF"));
});

test("LLM stock_availability group (no searchable detail) → admin handoff", async () => {
  // Text the regex backstop does NOT catch — the LLM group alone must divert it.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({});
  dependencies.extractChatSearchIntent = async () => ({
    group: "stock_availability",
    query: "",
    isProductQuery: false,
    partType: null,
    carBrand: null,
    carModel: null,
    year: null,
    partKind: null,
    tooBroad: false,
  });

  const result = await processLineWebhookPayload(
    textPayload("ของยังมีอยู่ใช่ป่าวครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0);
  assert.ok(calls.replies[0]?.text.includes("เช็กของให้ชัวร์"), "defers stock to admin");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
  assert.ok(calls.auditActions.includes("AI_STOCK_AVAILABILITY_HANDOFF"));
});

test("availability ask that names part + car in the message → normal search, no stock handoff", async () => {
  // "มีของ หม้อน้ำ D-Max ไหม" matches the availability regex BUT names the part
  // and car in the customer's own words — the search-logic carve-out must win.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หม้อน้ำ D-Max",
    intentPartType: "หม้อน้ำ",
    intentCarModel: "D-Max",
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "หม้อน้ำ (Radiator)", carModelName: "D-Max" },
  });

  const result = await processLineWebhookPayload(
    textPayload("มีของ หม้อน้ำ D-Max ไหมครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1, "named part+car must flow into the normal search");
  assert.ok(!calls.auditActions.includes("AI_STOCK_AVAILABILITY_HANDOFF"), "no stock handoff when detail is named");
});

test("LLM misfiles a named availability ask as stock_availability → still searches (normalized to product)", async () => {
  // Hardest guard: the LLM disobeys the prompt and answers stock_availability WITH
  // fields for "มีหม้อน้ำ D-Max ไหม" (regex does not match this phrasing). The
  // processor must normalize it to a product turn and search — never hand off.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    fitmentFilters: { categoryName: "หม้อน้ำ (Radiator)", carModelName: "D-Max" },
  });
  dependencies.extractChatSearchIntent = async () => ({
    group: "stock_availability",
    query: "หม้อน้ำ D-Max",
    isProductQuery: false,
    partType: "หม้อน้ำ",
    carBrand: null,
    carModel: "D-Max",
    year: null,
    partKind: "fitment",
    tooBroad: false,
  });

  const result = await processLineWebhookPayload(
    textPayload("มีหม้อน้ำ D-Max ไหมครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 1, "named part+car searches even when the LLM group says stock_availability");
  assert.ok(!calls.auditActions.includes("AI_STOCK_AVAILABILITY_HANDOFF"));
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
    fitmentFilters: { carModelName: "D-Max" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "หม้อน้ำ D-Max", code: "P0496", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
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

test("purchase intent wins over an FAQ auto-answer (regression: 'เอาตัว900')", async () => {
  // Reproduces the production regression on conversation 'ช่าง ชาร์ป': the AI group
  // classifier correctly flags the turn as `purchase` (route → PURCHASE_INTENT), but
  // because it's a non-product turn the FAQ layer ALSO decided it could answer, and
  // the FAQ branch used to sit ABOVE the purchase hand-off — so จูน replied with a
  // generic "ขอทราบรุ่นรถ ปีรถ" ask instead of handing the sale to a human.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    nonProductTurn: true,
    intentGroup: "purchase",
    // FAQ WOULD answer this non-product turn with the pre-empting "ask for car" line.
    faqReply: "สวัสดีค่ะ รบกวนขอทราบชื่อรุ่นรถ ปีรถ ด้วยนะคะ",
  });

  const result = await processLineWebhookPayload(
    textPayload("เอาตัว900"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.replies[0]?.text.includes("แอดมิน"), "purchase commitment hands off to a human");
  assert.ok(
    !calls.replies[0]?.text.includes("รุ่นรถ"),
    "the FAQ ask-for-details reply must not pre-empt the purchase hand-off",
  );
  assert.ok(calls.auditActions.includes("AI_PURCHASE_HANDOFF"), "logged as a purchase hand-off");
  assert.equal(calls.searches.length, 0, "a purchase commitment never runs a product search");
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
    { id: "product-1", name: "หม้อน้ำ D-Max 2003", code: "P1", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
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
    { id: "product-1", name: "คอยล์เย็น D-Max", code: "P2", imageUrl: null, salePrice: 900, retailPrice: 900, memberPrice: 900 },
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

test("inquiry frame: a car named this turn but unreadable drops the carried vehicle (ซิ้ตี้ case)", async () => {
  // Real case (conv cmq6o1g1u, 2026-07-25): after "อีซูซุเดก้า270" the customer asked
  // "พัดลมโบซิ้ตี้ปี12" (Honda City, run-on + mis-keyed). The classifier could not read
  // the model, so the session's Isuzu Deca answered instead — one ISUZU DECA blower
  // shown for a Honda City. The verified car mention proves a vehicle WAS named this
  // turn, so the carried car must go and the gate must ask which vehicle.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "Deca" },
    consolidatedQuery: "พัดลม Isuzu Deca",
    intentPartType: "พัดลม",
    // The car was named but neither brand nor model came out of it.
    intentCarBrand: null,
    intentCarModel: null,
    intentCarMentionInLatest: "ซิ้ตี้",
    intentYear: 2012,
    intentPartKind: "fitment",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "โบลเวอร์ ISUZU DECA/UD", code: "P0120", imageUrl: null, salePrice: 850, retailPrice: 850, memberPrice: 850 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("พัดลมโบซิ้ตี้ปี12"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 0, "must not search the previous car");
  assert.ok(calls.replies[0]?.text.includes("ยี่ห้อ"), "asks which vehicle instead of guessing");
  const framed = calls.savedFrames.at(-1);
  assert.equal(framed?.carBrand, null, "carried Isuzu dropped");
  assert.equal(framed?.carModel, null, "carried Deca dropped");
  assert.equal(framed?.year, 2012, "the year the customer gave THIS turn is kept");
});

test("inquiry frame: an unverifiable car mention is ignored (carry-over unchanged)", async () => {
  // The mention is LLM-produced, so it is only acted on when it really occurs in the
  // customer's latest text. A value that does not (a slip, or one merged out of
  // history) must fall back to the previous carry-over behaviour.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "D-Max" },
    consolidatedQuery: "พัดลม Isuzu D-Max",
    intentPartType: "พัดลม",
    intentCarBrand: null,
    intentCarModel: null,
    intentCarMentionInLatest: "วีโก้", // never typed in the latest message
    intentPartKind: "fitment",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "โบลเวอร์ Isuzu D-Max", code: "P1", imageUrl: null, salePrice: 850, retailPrice: 850, memberPrice: 850 },
  ];

  await processLineWebhookPayload(
    textPayload("พัดลมโบ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  const framed = calls.savedFrames.at(-1);
  assert.equal(framed?.carModel, "D-Max", "unverifiable mention must not drop the carried car");
  assert.equal(calls.searches.length, 1, "still searches the carried subject");
});

test("inquiry frame: a turn that names NO car keeps the carried vehicle (ปี-only follow-up)", async () => {
  // Guards the drip-feed path measured in production ("2007" alone → Toyota Vios):
  // mention=null means the customer named no vehicle this turn, so nothing changes.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "มอเตอร์พัดลม", carBrand: "Toyota", carModel: "Vios" },
    consolidatedQuery: "มอเตอร์พัดลม Toyota Vios 2007",
    intentPartType: "มอเตอร์พัดลม",
    intentCarBrand: null,
    intentCarModel: null,
    intentCarMentionInLatest: null,
    intentYear: 2007,
    intentPartKind: "fitment",
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "มอเตอร์พัดลม Toyota Vios", code: "P1", imageUrl: null, salePrice: 900, retailPrice: 900, memberPrice: 900 },
  ];

  await processLineWebhookPayload(
    textPayload("2007"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  const framed = calls.savedFrames.at(-1);
  assert.equal(framed?.carModel, "Vios", "carried car kept — no vehicle named this turn");
  assert.equal(calls.searches.length, 1, "searches the carried subject, does not re-ask");
});

test("inquiry frame: a car named AND read this turn is used normally", async () => {
  // The counterpart of the ซิ้ตี้ case: the mention resolved, so the new car simply
  // replaces the old one — the guard must not fire and wipe a car we understood.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "คอยล์เย็น", carBrand: "Isuzu", carModel: "Deca" },
    consolidatedQuery: "พัดลม Honda City",
    intentPartType: "พัดลม",
    intentCarBrand: "Honda",
    intentCarModel: "City",
    intentCarMentionInLatest: "ซิตี้",
    intentYear: 2012,
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)", carBrandName: "Honda", carModelName: "City" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "โบลเวอร์ HONDA City", code: "P0119", imageUrl: null, salePrice: 730, retailPrice: 730, memberPrice: 730 },
  ];

  await processLineWebhookPayload(
    textPayload("พัดลมโบซิตี้ปี12"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "searches the car the customer named");
  const framed = calls.savedFrames.at(-1);
  assert.equal(framed?.carModel, "City", "the model the customer named is kept");
  // The brand is dropped by the pre-existing per-turn brand guard (the customer typed
  // no "ฮอนด้า"/"Honda"), NOT by this guard — what matters here is that the carried
  // Isuzu Deca is gone and the model survived.
  assert.notEqual(framed?.carBrand, "Isuzu", "carried Isuzu must not survive");
  assert.notEqual(framed?.carModel, "Deca");
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

test("ungrounded classifier part rewrite: the search query falls back to the frame query (แผงแอร์→ตู้แอร์ case)", async () => {
  // Real case (conv cms07g5ew, 2026-07-25): the frame established "แผงแอร์"
  // (Condenser) for a Toyota Commuter, but on a sparse follow-up the classifier
  // rewrote query + partType to "ตู้แอร์" — a word the customer never typed —
  // which then resolved to the Evaporator category and sent cooling-coil
  // products. The frame correctly dropped the ungrounded part (test above), but
  // the classifier's consolidated QUERY still drove the search. It must fall
  // back to the frame query instead.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "แผงแอร์", carBrand: "Toyota", carModel: "Commuter" },
    consolidatedQuery: "ตู้แอร์ Commuter 2013",
    intentPartType: "ตู้แอร์",
    intentCarModel: "Commuter",
    intentYear: 2013,
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "คอยล์ร้อน (Condenser)", carBrandName: "Toyota", carModelName: "Hiace Commuter" },
  });

  await processLineWebhookPayload(
    textPayload("Commuter ปี2013ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.savedFrames.at(-1)?.partType, "แผงแอร์", "frame keeps the customer's part");
  assert.equal(calls.searches.length, 1);
  assert.equal(
    calls.searches.at(-1),
    "แผงแอร์ Toyota Commuter",
    "search uses the frame query, not the hallucinated rewrite",
  );
});

test("price turn: the LLM classifier's product subject beats the deterministic price-subject rule", async () => {
  // "คอยเย็น d-max ปี2015 ราคาเท่าไหร่" matches the price-subject rule's
  // cooling-unit pattern, which used to rewrite the WHOLE turn to a universal
  // "ตู้แอร์" subject and drop the car + year. The classifier read the turn
  // correctly — its intent must drive the search now.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "คอยเย็น d-max 2015",
    intentPartType: "คอยเย็น",
    intentCarBrand: "Isuzu",
    intentCarModel: "D-Max",
    intentYear: 2015,
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "คอยล์เย็น (Evaporator)", carBrandName: "Isuzu", carModelName: "D-Max" },
  });

  await processLineWebhookPayload(
    textPayload("คอยเย็น d-max ปี2015 ราคาเท่าไหร่ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1);
  assert.equal(
    calls.searches.at(-1),
    "คอยเย็น d-max 2015",
    "classifier query drives the search, not the rule's generic ตู้แอร์",
  );
  assert.equal(calls.searchFitmentHints[0]?.fitmentYear, 2015, "year survives (rule used to drop it)");
});

test("price turn: the price-subject rule still drives when the classifier returned nothing", async () => {
  // Classifier unavailable (Gemini down / returned null) — the deterministic
  // extractor remains the fallback so a plain cooling-unit price ask still
  // searches instead of dying.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({});

  await processLineWebhookPayload(
    textPayload("ตู้แอร์ ราคาเท่าไหร่ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.searches.length, 1);
  assert.equal(calls.searches.at(-1), "ตู้แอร์", "extractor fallback still searches the cooling unit");
});

test("Fix 1: a fresh (stale-session) turn keeps the classifier's spell-corrected part — no re-ask (คอล์ยเย็น case)", async () => {
  // Real case (conv cmr2xbf16): a NEW session ("คอล์ยเย็นนิสสันมาร์ค") after a
  // 9-day gap. The classifier spell-corrects to "คอยล์เย็น", but a STALE stored part
  // used to enable the evidence gate, which then dropped the corrected part (it isn't
  // literally in the misspelled text) → CAR_ONLY re-ask. Fix 1: a stale session has no
  // live part to protect → keep the classifier part → it searches + shows.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "ออนิว", carModel: "D-Max" },
    storedFrameUpdatedAt: new Date(Date.now() - 9 * 24 * 60 * 60_000), // 9 days ago → stale
    consolidatedQuery: "คอยล์เย็น นิสสัน มาร์ช",
    intentPartType: "คอยล์เย็น",
    intentCarBrand: "Nissan",
    intentCarModel: "March",
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "คอยล์เย็น (Evaporator)", carBrandName: "Nissan", carModelName: "March" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "คอยล์เย็น Nissan March", code: "P1", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
  ];

  const result = await processLineWebhookPayload(
    textPayload("คอล์ยเย็นนิสสันมาร์ค"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.savedFrames.at(-1)?.partType, "คอยล์เย็น", "corrected part is kept, not dropped");
  assert.equal(calls.searches.length, 1, "searches instead of re-asking for the part");
  assert.ok(!calls.auditActions.includes("AI_SEARCH_GATE_ASK"), "does not fall back to CAR_ONLY ask");
});

test("Fix 2: a MISSPELLED new part in a live session is kept via typo evidence (not dropped as hallucination)", async () => {
  // Live session with a different stored part ("สายแอร์"). This turn the customer
  // switches parts but mis-keys it ("คอล์ยเย็น"). The literal evidence check fails on
  // the typo, but typo-tolerant evidence recognises it → the corrected "คอยล์เย็น"
  // is kept and searched (topic shift), not silently replaced by the stored part.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "สายแอร์", carModel: "March" },
    consolidatedQuery: "คอยล์เย็น นิสสัน มาร์ช",
    intentPartType: "คอยล์เย็น",
    intentCarBrand: "Nissan",
    intentCarModel: "March",
    intentPartKind: "fitment",
    fitmentFilters: { categoryName: "คอยล์เย็น (Evaporator)", carBrandName: "Nissan", carModelName: "March" },
  });
  dependencies.getChatProductSummaries = async () => [
    { id: "product-1", name: "คอยล์เย็น Nissan March", code: "P1", imageUrl: null, salePrice: 1500, retailPrice: 1500, memberPrice: 1500 },
  ];

  await processLineWebhookPayload(
    textPayload("คอล์ยเย็นนิสสันมาร์ค"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(calls.savedFrames.at(-1)?.partType, "คอยล์เย็น", "misspelled new part is kept via typo evidence");
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

test("part-image gate (Option A+B): a compressor photo with only a category + non-catalog stamped number asks for the car (does NOT search)", async () => {
  // Production regression (LINE conv cmryljcnx, 2026-07-24): a bare compressor photo
  // read as partType=คอมแอร์ (fitment), no brand/model/year, whose OCR only yielded
  // the category words plus a number stamped on the body ("072060" — NOT a catalog
  // SKU). The old override treated that stamped number as a "specific identifier" and
  // searched, presenting random compressors. It must instead ask for the vehicle,
  // exactly like the equivalent text turn ("คอมแอร์รุ่นนี้มีไหม") already does.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageHints: ["คอมแอร์", "คอมเพรสเซอร์แอร์", "072060"],
    imagePartType: "คอมแอร์",
    imagePartKind: "fitment",
    catalogCodes: [], // 072060 is not a real SKU (and is pure-numeric anyway)
  });

  await processLineWebhookPayload(
    imagePayload("event-img-compressor-nocar"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  assert.equal(calls.searches.length, 0, "no validated code + no car → must not search");
  assert.ok(
    calls.auditActions.includes("AI_SEARCH_GATE_ASK"),
    "asks the customer for the car instead of presenting mismatched compressors",
  );
});

test("part-image gate (Option A+B): a photo carrying a validated catalog SKU searches without re-asking the car", async () => {
  // The counterpart to the case above: when the photo's OCR yields a code that DOES
  // resolve to a real catalog product, the turn is specific enough to search directly
  // (Option A preserved) — we don't force a "which car?" round-trip.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageHints: ["คอมแอร์", "STA-7018"],
    imagePartType: "คอมแอร์",
    imagePartKind: "fitment",
    catalogCodes: ["sta-7018"],
  });

  await processLineWebhookPayload(
    imagePayload("event-img-compressor-code"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "a validated SKU on the photo searches without asking the car");
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
  // The photo carries a REAL Valeo SKU (z0016525a) that resolves in the catalog, so
  // the turn is specific enough to search without re-asking the car (Option A+B) —
  // and the stale Honda Civic hard filters are dropped to a compressor-only search.
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "compressor", carBrand: "Honda", carModel: "Civic" },
    imageKind: "part_image",
    imageHints: ["Valeo Z0016525A", "compressor 24v"],
    imagePartType: "compressor",
    imagePartKind: "fitment",
    catalogCodes: ["z0016525a"],
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

test("multi-subject price ask shows product blocks, appends the price note, freezes, and notifies admin", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    priceTier: "RETAIL",
    // Both subjects lock to a resolved car so the vehicle-unresolved guard stays out.
    fitmentFilters: { carModelName: "D-Max" },
  });
  dependencies.generateChatSuggestion = async () => stubChatSuggestion();
  // NOTE: subjects avoid คอยล์เย็น/ตู้/น้ำยา wording so the deterministic
  // price-subject extractor (extractPriceProductSubjectsFromText) stays out and
  // the classifier's multi-subject list drives the turn.
  dependencies.extractChatSearchIntent = async () => ({
    group: "product",
    query: "คอมแอร์ แผงแอร์ D-Max",
    isProductQuery: true,
    partType: "คอมแอร์",
    carBrand: null,
    carModel: "D-Max",
    year: null,
    partKind: "fitment" as const,
    tooBroad: false,
    subjects: [
      { partType: "คอมแอร์", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment" as const, query: "คอมแอร์ D-Max" },
      { partType: "แผงแอร์", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment" as const, query: "แผงแอร์ D-Max" },
    ],
  });

  const result = await processLineWebhookPayload(
    textPayload("คอมแอร์กับแผงแอร์ D-Max ราคาเท่าไหร่ครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(calls.auditActions.includes("AI_MULTI_SUBJECT"));
  assert.equal(calls.searches.length, 2, "each subject still searches");
  const sentTexts = calls.replies.flatMap((reply) => reply.texts ?? []);
  assert.ok(
    sentTexts.some((text) => text.includes("ส่วนเรื่องราคา")),
    "price note appended after the product blocks (same policy as the single path)",
  );
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "room frozen for admin price confirmation");
  assert.equal(calls.notifyHandoffs.length, 1, "admin notified exactly once");
});

test("mapped categories recover two LINE subjects when the LLM returns only one top-level subject", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    fitmentFilters: { carModelName: "Triton" },
  });
  dependencies.generateChatSuggestion = async () => stubChatSuggestion();
  dependencies.extractChatSearchIntent = async () => ({
    ...productSearchIntent("วาล์ว/ไดรเออร์ Triton ปี 2013"),
    partType: "วาล์ว",
    carModel: "Triton",
    year: 2013,
    partKind: "fitment" as const,
  });
  dependencies.detectChatMultiSubjects = async () => ({
    source: "category_mapping" as const,
    handoffReason: null,
    categories: ["Expansion Valve", "Drier"],
    subjects: [
      { partType: "วาล์ว", carBrand: null, carModel: "Triton", year: 2013, partKind: "fitment" as const, query: "วาล์ว Triton 2013" },
      { partType: "ไดรเออร์", carBrand: null, carModel: "Triton", year: 2013, partKind: "fitment" as const, query: "ไดรเออร์ Triton 2013" },
    ],
  });

  const result = await processLineWebhookPayload(
    textPayload("วาล์ว/ไดรเออร์มิตซูไททันปี13"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.equal(calls.searches.length, 2);
  assert.ok(calls.auditActions.includes("MULTI_SUBJECT_DETECTED"));
  assert.ok(!calls.statePatchTypes.includes("waiting_admin"));
});

test("ambiguous per-subject vehicle mapping performs no LINE search and hands off", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();
  dependencies.detectChatMultiSubjects = async () => ({
    subjects: null,
    source: "none" as const,
    handoffReason: "AMBIGUOUS_VEHICLE_BINDING" as const,
    categories: ["Expansion Valve", "Drier"],
  });

  await processLineWebhookPayload(
    textPayload("วาล์ว Triton กับ ไดรเออร์ D-Max"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.deepEqual(calls.searches, []);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
});

test("LINE fails closed when LLM claims multi-subject but canonical mapping is unavailable", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps();
  dependencies.extractChatSearchIntent = async () => ({
    ...productSearchIntent("วาล์ว/ไดรเออร์ Triton"),
    subjects: [
      { partType: "วาล์ว", carBrand: null, carModel: "Triton", year: null, partKind: "fitment" as const, query: "วาล์ว Triton" },
      { partType: "ไดรเออร์", carBrand: null, carModel: "Triton", year: null, partKind: "fitment" as const, query: "ไดรเออร์ Triton" },
    ],
  });
  dependencies.detectChatMultiSubjects = async () => {
    throw new Error("category alias database unavailable");
  };

  await processLineWebhookPayload(
    textPayload("วาล์ว/ไดรเออร์ Triton"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.deepEqual(calls.searches, []);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.equal(calls.notifyHandoffs.length, 1);
});

test("multi-subject: any unresolved subject hands off and freezes after suppressing unsafe products", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // No fitmentFilters configured → the resolver returns no carModelName, so the
  // Strada subject's rows are NOT vehicle-scoped (the exact mismatch class the
  // single path guards with vehicleUnresolvedGuard).
  const { calls, dependencies } = createProcessorTestDeps();
  dependencies.generateChatSuggestion = async () => stubChatSuggestion();
  dependencies.extractChatSearchIntent = async () => ({
    group: "product",
    query: "สายแอร์ สตาด้า กับ ฟองน้ำ",
    isProductQuery: true,
    partType: "สายแอร์",
    carBrand: null,
    carModel: "สตาด้า2500",
    year: null,
    partKind: "fitment" as const,
    tooBroad: false,
    subjects: [
      { partType: "สายแอร์", carBrand: null, carModel: "สตาด้า2500", year: null, partKind: "fitment" as const, query: "สายแอร์ สตาด้า2500" },
      { partType: "ฟองน้ำ", carBrand: null, carModel: null, year: null, partKind: "universal" as const, query: "ฟองน้ำแอร์" },
    ],
  });

  const result = await processLineWebhookPayload(
    textPayload("สายแอร์สตาด้า2500 กับฟองน้ำแอร์ มีไหมครับ"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  const sentTexts = calls.replies.flatMap((reply) => reply.texts ?? []);
  assert.ok(
    sentTexts.some((text) => text.includes("สายแอร์") && text.includes("แอดมินช่วยเช็ก")),
    "unresolved-car subject degrades to its no-match hand-off line",
  );
  assert.equal(calls.notifyHandoffs.length, 1, "admin notified for the suppressed subject");
  assert.ok(calls.statePatchTypes.includes("waiting_admin"), "AI pauses after any subject fails");
});

test("admin-owned conversation: draft is stored without spending Gemini generate / purchase / FAQ calls", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    conversationStatus: LineConversationAiStatus.PAUSED_BY_ADMIN,
    consolidatedQuery: "คอยล์เย็น vios",
    intentPartType: "คอยล์เย็น",
    intentCarModel: "Vios",
    intentPartKind: "fitment",
    fitmentFilters: { carModelName: "Vios" },
  });
  let generateCalls = 0;
  let purchaseCalls = 0;
  let faqCalls = 0;
  dependencies.generateChatSuggestion = async () => {
    generateCalls += 1;
    return stubChatSuggestion();
  };
  dependencies.classifyPurchaseIntent = async () => {
    purchaseCalls += 1;
    return false;
  };
  dependencies.answerFromChatFaq = async () => {
    faqCalls += 1;
    return { answered: false, reply: "" };
  };

  const result = await processLineWebhookPayload(
    textPayload("คอยล์เย็น vios"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 0, "admin-owned room never auto-replies");
  assert.deepEqual(calls.replies, []);
  assert.equal(generateCalls, 0, "Gemini reply generation skipped (template draft instead)");
  assert.equal(purchaseCalls, 0, "purchase-intent Gemini fallback skipped");
  assert.equal(faqCalls, 0, "FAQ Gemini call skipped");
  assert.equal(calls.searches.length, 1, "search still runs so the draft carries real matches");
  assert.equal(calls.suggestions.length, 1, "draft suggestion still stored for the admin console");
  assert.equal(calls.suggestions[0]?.deliveryMode, LineDeliveryMode.NONE);
});

// Regression (production 2026-08-01, conversation "sunantha"): the customer asked
// "มูเล่หน้าครัชซิตี้96" by text, then 74 min later sent photos of a blend-door
// actuator. Vision read the photos correctly ("มอเตอร์ปรับอากาศ") but only at
// MEDIUM confidence, so the frame kept the earlier part — the search ran the
// self-contradictory "มูเล่หน้าครัช Honda City มอเตอร์ปรับอากาศ …" (zero results)
// and จูน replied "จูนเห็นรูปมูเล่หน้าครัชสำหรับ Honda Cityที่ส่งมา", naming a part
// that was not in the photo at all.
test("part image whose subject contradicts the carried frame drives the turn (not the stale part)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "มูเล่หน้าครัช", carBrand: "Honda", carModel: "City", year: 1996 },
    imageKind: "part_image",
    imageConfidence: "MEDIUM",
    imagePartType: "มอเตอร์ปรับอากาศ",
    imagePartKind: "fitment",
    imageHints: ["มอเตอร์ปรับอากาศ", "มอเตอร์ผสมอากาศ", "blend door actuator"],
    searchTotal: 0,
  });

  await processLineWebhookPayload(
    imagePayload("event-img-subject-contradicts-frame"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  assert.ok(
    calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"),
    "the contradiction between the photo and the carried part is audited",
  );
  assert.match(
    calls.searches.at(-1) ?? "",
    /มอเตอร์ปรับอากาศ/,
    "the search runs on the part actually shown in the photo",
  );
  assert.doesNotMatch(
    calls.searches.at(-1) ?? "",
    /มูเล่/,
    "the carried part is not merged into the query",
  );

  const reply = calls.replies[0]?.text ?? "";
  assert.match(reply, /มอเตอร์ปรับอากาศ/, "จูน acknowledges the part in the photo");
  assert.doesNotMatch(reply, /มูเล่/, "จูน never names the previous turn's part back");
  assert.doesNotMatch(reply, /Cityที่ส่งมา/, "a Latin car name is spaced off the following Thai word");

  assert.equal(
    calls.savedFrames.at(-1)?.partType,
    "มูเล่หน้าครัช",
    "a MEDIUM read steers only this turn — it never becomes the session's standing subject",
  );
});

test("part image whose subject matches the carried frame leaves the frame alone", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "หน้าครัช (Compressor Clutch)", carBrand: "Honda", carModel: "City" },
    imageKind: "part_image",
    imageConfidence: "MEDIUM",
    imagePartType: "หน้าครัช",
    imagePartKind: "fitment",
    imageHints: ["หน้าครัช", "compressor clutch"],
    searchTotal: 0,
  });

  await processLineWebhookPayload(
    imagePayload("event-img-subject-matches-frame"),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    dependencies,
  );

  assert.equal(
    calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"),
    false,
    "a photo of the SAME part (short word vs canonical name) is a continuation, not a new subject",
  );
});

// ── Golden suite: evidence-based promotion of an image subject (Option B) ─────
// The contradiction guard (Option C) lets a MEDIUM photo steer its OWN turn. B is
// the follow-up question: may that photo also become the session's standing
// subject? Only when the catalog corroborates the read — never on vision
// confidence alone. These cases pin every branch of that decision, so a future
// change cannot quietly widen (or silence) the promotion.

/** A MEDIUM photo showing a DIFFERENT part from the one carried in the frame. */
const contradictingImageTurn = {
  storedFrame: { partType: "มูเล่หน้าครัช", carBrand: "Honda", carModel: "City", year: 1996 },
  imageKind: "part_image" as const,
  imageConfidence: "MEDIUM" as const,
  imagePartType: "มอเตอร์ปรับอากาศ",
  imagePartKind: "fitment" as const,
  imageHints: ["มอเตอร์ปรับอากาศ", "blend door actuator"],
};

const runImageTurn = async (
  deps: LineWebhookProcessorDependencies,
  lineEventId: string,
): Promise<void> => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  await processLineWebhookPayload(
    imagePayload(lineEventId),
    {
      channelAccessToken: "token",
      autoReplyEnabled: true,
      dryRun: false,
      imageSearchEnabled: true,
      receivedAt: new Date(),
    },
    deps,
  );
};

test("B promotes the image subject when the catalog corroborates it (category + shown rows)", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    fitmentFilters: {
      categoryName: "มอเตอร์ปรับอากาศ (Blend Door Actuator)",
      carBrandName: "Honda",
      carModelName: "City",
    },
  });

  await runImageTurn(dependencies, "event-img-b-promote");

  assert.ok(calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"), "guard C still fires");
  assert.ok(
    calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"),
    "corroborated read is promoted",
  );
  assert.deepEqual(
    calls.savedFrames.at(-1),
    { partType: "มอเตอร์ปรับอากาศ", carBrand: "Honda", carModel: "City", year: 1996 },
    "the photo's part becomes the standing subject; the vehicle slots are untouched",
  );
  assert.equal(calls.savedFrames.length, 2, "exactly one extra frame write, never more");
});

test("B does not promote when the search found nothing (the real 2026-08-01 turn)", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    searchTotal: 0,
    fitmentFilters: { categoryName: "มอเตอร์ปรับอากาศ (Blend Door Actuator)" },
  });

  await runImageTurn(dependencies, "event-img-b-no-match");

  assert.ok(calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"), "guard C still fires");
  assert.equal(
    calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"),
    false,
    "an uncorroborated read never becomes the standing subject",
  );
  assert.equal(calls.savedFrames.at(-1)?.partType, "มูเล่หน้าครัช", "stored frame is left as-is");
  assert.equal(calls.savedFrames.length, 1, "no second frame write");
});

test("B does not promote on a vehicle-only match (no category resolved)", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    searchTotal: 3,
    searchIds: ["prod-1", "prod-2", "prod-3"],
    // Rows came back, but the part word mapped to NO category — they are Honda City
    // parts matched on the car alone, which must never persist a misread part.
    fitmentFilters: { carBrandName: "Honda", carModelName: "City" },
  });

  await runImageTurn(dependencies, "event-img-b-vehicle-only");

  assert.equal(
    calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"),
    false,
    "rows matched on the car alone are not evidence about the part",
  );
  assert.equal(calls.savedFrames.at(-1)?.partType, "มูเล่หน้าครัช");
});

test("B does not promote when the relevance gate suppresses the rows", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    // Category-less result set with no strong match reason → weakCategoryMatchGuard.
    searchMatchReasons: { "prod-1": [], "prod-2": [] },
    fitmentFilters: { carBrandName: "Honda", carModelName: "City" },
  });

  await runImageTurn(dependencies, "event-img-b-weak-match");

  assert.equal(
    calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"),
    false,
    "rows too weak to show are too weak to rewrite the standing subject",
  );
  assert.equal(calls.savedFrames.at(-1)?.partType, "มูเล่หน้าครัช");
});

test("B does not promote a broad part word even when rows are shown", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    imagePartType: "อะไหล่แอร์",
    imageHints: ["อะไหล่แอร์"],
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    fitmentFilters: { categoryName: "อะไหล่อื่นๆ", carBrandName: "Honda", carModelName: "City" },
  });

  await runImageTurn(dependencies, "event-img-b-broad");

  assert.equal(
    calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"),
    false,
    "a broad word is never a standing subject (same rule as the normal frame save)",
  );
});

test("B never fires without the contradiction guard: photo agrees with the frame", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "หน้าครัช (Compressor Clutch)", carBrand: "Honda", carModel: "City" },
    imageKind: "part_image",
    imageConfidence: "MEDIUM",
    imagePartType: "หน้าครัช",
    imagePartKind: "fitment",
    imageHints: ["หน้าครัช"],
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    fitmentFilters: {
      categoryName: "หน้าครัช (Compressor Clutch)",
      carBrandName: "Honda",
      carModelName: "City",
    },
  });

  await runImageTurn(dependencies, "event-img-b-agrees");

  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"), false);
  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"), false);
  assert.equal(calls.savedFrames.length, 1, "a continuation writes the frame exactly once");
});

test("B never fires on a HIGH read: the existing imageFields path still owns the frame", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    imageConfidence: "HIGH",
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    fitmentFilters: {
      categoryName: "มอเตอร์ปรับอากาศ (Blend Door Actuator)",
      carBrandName: "Honda",
      carModelName: "City",
    },
  });

  await runImageTurn(dependencies, "event-img-b-high");

  assert.equal(
    calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"),
    false,
    "a HIGH read reaches the frame through reconcileInquiryFrame, not the guard",
  );
  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"), false);
  assert.equal(
    calls.savedFrames.at(-1)?.partType,
    "มอเตอร์ปรับอากาศ",
    "the pre-existing HIGH path is untouched by B",
  );
  assert.equal(calls.savedFrames.length, 1, "HIGH still writes the frame exactly once");
});

test("B never fires on a LOW read: the turn asks for confirmation instead", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    imageConfidence: "LOW",
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    fitmentFilters: { categoryName: "มอเตอร์ปรับอากาศ (Blend Door Actuator)" },
  });

  await runImageTurn(dependencies, "event-img-b-low");

  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"), false);
  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"), false);
  assert.deepEqual(calls.searches, [], "a LOW image-only turn still never searches");
});

test("B never fires on a payment slip", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { partType: "มูเล่หน้าครัช", carBrand: "Honda", carModel: "City" },
    imageKind: "payment_slip",
    imageConfidence: "HIGH",
  });

  await runImageTurn(dependencies, "event-img-b-slip");

  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"), false);
  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"), false);
  assert.deepEqual(calls.savedFrames, [], "a non-product turn never touches the frame");
});

test("B never fires when vision read no part type at all", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    ...contradictingImageTurn,
    imagePartType: null,
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    fitmentFilters: {
      categoryName: "หน้าครัช (Compressor Clutch)",
      carBrandName: "Honda",
      carModelName: "City",
    },
  });

  await runImageTurn(dependencies, "event-img-b-no-parttype");

  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"), false);
  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"), false);
  assert.equal(calls.savedFrames.at(-1)?.partType, "มูเล่หน้าครัช", "carried subject survives");
});

test("B never fires on a first-contact photo (no carried part to contradict)", async () => {
  const { calls, dependencies } = createProcessorTestDeps({
    imageKind: "part_image",
    imageConfidence: "MEDIUM",
    imagePartType: "มอเตอร์ปรับอากาศ",
    imagePartKind: "fitment",
    imageHints: ["มอเตอร์ปรับอากาศ"],
    searchTotal: 2,
    searchIds: ["prod-1", "prod-2"],
    fitmentFilters: { categoryName: "มอเตอร์ปรับอากาศ (Blend Door Actuator)" },
  });

  await runImageTurn(dependencies, "event-img-b-first-contact");

  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"), false);
  assert.equal(calls.auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"), false);
});

// ── Golden suite: a broad OPENER asks for details instead of freezing the room ──
// Production 2026-08-02 (conv cmsbfjzlo): a first-time customer wrote "สวัสดีครับ"
// then "สอบถามอะไหล่รถครับ". The phrase matches the broad pattern /อะไหล่\s*รถ/, so
// the turn forced BROAD_PART_TYPE_HANDOFF — จูน answered "ขอส่งเรื่องให้แอดมิน",
// froze the room and notified a human, for a customer who had simply not said what
// they wanted yet. It must ask for the three things a search needs and stay active.
// The freeze is still correct MID-conversation, where the same broad wording is a
// follow-up on a subject the customer already gave.

const BROAD_OPENER = "สอบถามอะไหล่รถครับ";

test("broad OPENER with no carried subject asks for the 3 details and keeps the AI active", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "สอบถามอะไหล่รถ",
  });

  const result = await processLineWebhookPayload(
    textPayload(BROAD_OPENER, "event-broad-opener"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  const reply = calls.replies[0]?.text ?? "";
  assert.match(reply, /ยี่ห้อ \/ รุ่นรถ/, "asks for the vehicle");
  assert.match(reply, /อะไหล่ที่ต้องการ/, "asks for the part");
  assert.match(reply, /รูปอะไหล่เก่า/, "asks for a photo");
  assert.doesNotMatch(reply, /แอดมิน/, "จูน handles it herself — no hand-off wording");

  assert.equal(
    calls.statePatchTypes.includes("waiting_admin"),
    false,
    "the room must NOT be frozen — the customer is about to answer",
  );
  assert.equal(calls.notifyHandoffs.length, 0, "no admin is pulled in for an unanswered opener");
  assert.ok(calls.auditActions.includes("AI_BROAD_PART_TYPE_ASK"));
  assert.equal(calls.auditActions.includes("AI_UNCERTAIN_PRODUCT_HANDOFF"), false);
  assert.equal(calls.searches.length, 0, "still must not search on broad text");
});

test("the same broad wording MID-conversation still hands off (carried subject is not thrown away)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    // The customer already gave part + car + year on an earlier turn.
    storedFrame: { partType: "คอยล์เย็น", carBrand: "Toyota", carModel: "Vios", year: 2018 },
    consolidatedQuery: "สอบถามอะไหล่รถ",
  });

  const result = await processLineWebhookPayload(
    textPayload(BROAD_OPENER, "event-broad-followup"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(result.repliedCount, 1);
  assert.ok(
    calls.auditActions.includes("AI_UNCERTAIN_PRODUCT_HANDOFF"),
    "an established inquiry keeps the previous hand-off behaviour",
  );
  assert.equal(calls.auditActions.includes("AI_BROAD_PART_TYPE_ASK"), false);
  assert.ok(calls.statePatchTypes.includes("waiting_admin"));
  assert.doesNotMatch(
    calls.replies[0]?.text ?? "",
    /ยี่ห้อ \/ รุ่นรถ/,
    "never re-ask for details the customer already gave",
  );
});

test("a carried YEAR alone is enough context to keep the hand-off", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    storedFrame: { year: 2018 },
    consolidatedQuery: "สอบถามอะไหล่รถ",
  });

  await processLineWebhookPayload(
    textPayload(BROAD_OPENER, "event-broad-year-only"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.equal(
    calls.auditActions.includes("AI_BROAD_PART_TYPE_ASK"),
    false,
    "any established slot (part / brand / model / year) counts as an ongoing inquiry",
  );
});

test("a broad opener phrased with อะไหล่แอร์ is treated the same way", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({
    consolidatedQuery: "หาอะไหล่แอร์",
  });

  await processLineWebhookPayload(
    textPayload("หาอะไหล่แอร์ครับ", "event-broad-aircon-opener"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.ok(calls.auditActions.includes("AI_BROAD_PART_TYPE_ASK"));
  assert.equal(calls.statePatchTypes.includes("waiting_admin"), false);
});

test("a broad opener that reads as an availability question also asks instead of freezing", async () => {
  // The live classifier files "มีอะไหล่แอร์ไหมครับ" as `stock_availability`, which
  // reaches the stock hand-off — a different door to the same frozen room. A broad
  // parts word with nothing named must take the ask on BOTH doors.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ consolidatedQuery: "อะไหล่แอร์" });
  dependencies.extractChatSearchIntent = async () => ({
    group: "stock_availability",
    query: "อะไหล่แอร์",
    isProductQuery: false,
    partType: null,
    carBrand: null,
    carModel: null,
    year: null,
    partKind: null,
    tooBroad: true,
  });

  await processLineWebhookPayload(
    textPayload("มีอะไหล่แอร์ไหมครับ", "event-broad-stock-opener"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.ok(calls.auditActions.includes("AI_BROAD_PART_TYPE_ASK"));
  assert.equal(calls.auditActions.includes("AI_STOCK_AVAILABILITY_HANDOFF"), false);
  assert.equal(calls.statePatchTypes.includes("waiting_admin"), false, "must not freeze");
  assert.match(calls.replies[0]?.text ?? "", /ยี่ห้อ \/ รุ่นรถ/);
});

test("a bare availability ask with NO parts word keeps its stock hand-off", async () => {
  // "ที่ร้านมีของใช้ไหมคัฟ" names no part at all, so it is not a broad parts
  // opener — confirming stock stays a human job, exactly as before.
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createProcessorTestDeps({ consolidatedQuery: "มีของไหม" });
  dependencies.extractChatSearchIntent = async () => ({
    group: "stock_availability",
    query: "มีของไหม",
    isProductQuery: false,
    partType: null,
    carBrand: null,
    carModel: null,
    year: null,
    partKind: null,
    tooBroad: false,
  });

  await processLineWebhookPayload(
    textPayload("ที่ร้านมีของใช้ไหมคัฟ", "event-bare-stock-ask"),
    { channelAccessToken: "token", autoReplyEnabled: true, dryRun: false, receivedAt: new Date() },
    dependencies,
  );

  assert.ok(calls.auditActions.includes("AI_STOCK_AVAILABILITY_HANDOFF"), "unchanged behaviour");
  assert.equal(calls.auditActions.includes("AI_BROAD_PART_TYPE_ASK"), false);
});
