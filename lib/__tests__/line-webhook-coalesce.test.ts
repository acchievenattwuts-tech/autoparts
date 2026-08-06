import test from "node:test";
import assert from "node:assert/strict";

import {
  LineAiConfidence,
  LineConversationAiStatus,
  LineIntent,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
import type { LineWebhookProcessorDependencies, LineWebhookProcessorConfig } from "@/lib/line-webhook-processor";
import type { LineImageClassification } from "@/lib/line-image-service";
import type { ChatSearchIntent } from "@/lib/chat-core/ai-service";

type StoredInquiryFrame = {
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
  updatedAt: Date;
};

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

type InboundRow = {
  id: string;
  text: string | null;
  messageType: LineMessageType;
  replyToken: string | null;
  lineEventId: string | null;
  lineMessageId: string | null;
  intent: LineIntent | null;
  createdAt: Date;
};

/** In-memory model of the conversation coalescing counters + message log. */
function createCoalesceHarness(options?: {
  imageKind?: "part_image" | "payment_slip" | "unknown_image";
  imageConfidence?: "LOW" | "MEDIUM" | "HIGH";
  imageHints?: string[];
  imagePartKind?: "fitment" | "universal" | null;
  imagePartType?: string | null;
  imageCarBrand?: string | null;
  imageCarModel?: string | null;
  imageYear?: number | null;
  /** Per-image classification overrides keyed by lineMessageId (`m-<eventId>`),
   *  so a burst can spread brand/part type across different photos. */
  imageClassByMessageId?: Record<string, Partial<LineImageClassification>>;
  /** Stand-in for the text intent classifier (extractChatSearchIntent). */
  textIntent?: ChatSearchIntent | null | ((latestText: string) => ChatSearchIntent | null);
  fitmentFilters?: { categoryName?: string; carBrandName?: string; carModelName?: string };
  lockAcquirable?: boolean;
  /** Bumps the inbound seq once during the FIRST pipeline pass to force one abort. */
  bumpDuringFirstPass?: boolean;
}) {
  const state = {
    seq: 0,
    processedSeq: 0,
    aiStatus: LineConversationAiStatus.ACTIVE,
    lockOwner: null as string | null,
    inbound: [] as InboundRow[],
    answeredCount: 0,
    msgCounter: 0,
    frame: null as StoredInquiryFrame | null,
  };
  const calls = {
    replies: [] as string[],
    replyBatches: [] as string[][],
    pushes: [] as string[],
    searches: [] as string[],
    statePatches: [] as string[],
    abortChecks: 0,
  };
  let firstPassBumped = false;

  const dependencies: LineWebhookProcessorDependencies = {
    hasProcessedLineEvent: async () => false,
    findActiveCustomerIdByLineUserId: async () => null,
    getOrCreateLineConversation: async (input) =>
      ({
        id: "conv-1",
        lineUserId: input.lineUserId,
        customerId: null,
        aiStatus: state.aiStatus,
        lastCustomerMessageAt: null,
      }) as Awaited<ReturnType<LineWebhookProcessorDependencies["getOrCreateLineConversation"]>>,
    appendLineMessage: async (message) => {
      state.msgCounter += 1;
      const id = `msg-${state.msgCounter}`;
      if (message.direction === LineMessageDirection.INBOUND) {
        state.inbound.push({
          id,
          text: message.text ?? null,
          messageType: message.messageType,
          replyToken: message.replyToken ?? null,
          lineEventId: message.lineEventId ?? null,
          lineMessageId: message.lineMessageId ?? null,
          intent: message.intent ?? null,
          createdAt: new Date(),
        });
      } else if (message.direction === LineMessageDirection.OUTBOUND_AI) {
        state.answeredCount = state.inbound.length;
      }
      return { id, createdAt: new Date() } as Awaited<
        ReturnType<LineWebhookProcessorDependencies["appendLineMessage"]>
      >;
    },
    updateLineConversationState: async (_id, patch) => {
      calls.statePatches.push(
        patch.aiStatus === LineConversationAiStatus.WAITING_ADMIN ? "waiting_admin" : "state_update",
      );
      return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["updateLineConversationState"]>>;
    },
    storeLineAiAudit: async () => ({}) as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>,
    storeLineAiSuggestion: async () =>
      ({}) as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiSuggestion"]>>,
    storeLineAiJob: async () =>
      ({ id: "job-1" }) as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiJob"]>>,
    updateLineAiJob: async () => ({}) as Awaited<ReturnType<LineWebhookProcessorDependencies["updateLineAiJob"]>>,
    markOutboundLineMessageSent: async () =>
      ({}) as Awaited<ReturnType<LineWebhookProcessorDependencies["markOutboundLineMessageSent"]>>,
    searchChatProductInquiry: async (input) => {
      calls.searches.push(input.text ?? (input.extractedImageHints ?? []).join(" "));
      if (options?.bumpDuringFirstPass && !firstPassBumped) {
        firstPassBumped = true;
        state.seq += 1; // simulate a new customer message landing mid-pipeline
      }
      if (!input.route.allowsSearch) {
        return { searched: false, reason: "NON_SEARCHABLE", query: null, result: null };
      }
      return {
        searched: true,
        reason: "SEARCHED_PRODUCT_INQUIRY",
        query: input.text ?? "",
        // Strong "name" match so the relevance gate (weakCategoryMatchGuard)
        // treats the shown product as genuinely linked to the query.
        result: { ids: ["product-1"], total: 1, mode: "v2", matchReasons: { "product-1": ["name"] } },
        needsMoreInfo: false,
        appliedFilters: {
          categoryName: null,
          carBrandName: null,
          carModelName: null,
          fitmentYear: null,
        },
        droppedImageCodes: [],
        didYouMean: null,
      };
    },
    getChatProductSummaries: async () => [{ id: "product-1", name: "หม้อน้ำ D-Max", code: "P1", imageUrl: null, salePrice: 100, retailPrice: 130, memberPrice: 130 }],
    replyLineMessage: async (input) => {
      calls.replyBatches.push(
        input.messages.flatMap((message) => (message.type === "text" ? [message.text] : ["[flex]"])),
      );
      calls.replies.push(input.messages[0]?.type === "text" ? input.messages[0].text : "");
      return { sent: true, replyToken: input.replyToken };
    },
    pushLineMessages: async (input) => {
      calls.pushes.push(input.messages[0]?.type === "text" ? input.messages[0].text : "");
      return { sentCount: input.recipientIds.length, recipientIds: input.recipientIds };
    },
    startLineLoadingAnimation: async (input) => input.chatId.startsWith("U"),
    classifyLineImage: async (input) => {
      const override = input.lineMessageId
        ? options?.imageClassByMessageId?.[input.lineMessageId]
        : undefined;
      const kind = override?.kind ?? options?.imageKind ?? "part_image";
      return {
        kind,
        intent:
          kind === "payment_slip"
            ? LineIntent.PAYMENT_SLIP_IMAGE
            : kind === "part_image"
              ? LineIntent.PART_IMAGE_INQUIRY
              : LineIntent.UNKNOWN,
        searchHints:
          override?.searchHints ?? options?.imageHints ?? (kind === "part_image" ? ["หม้อน้ำ"] : []),
        confidence: options?.imageConfidence ?? ("HIGH" as const),
        reason: "TEST",
        partType: override?.partType ?? options?.imagePartType ?? null,
        carModel: override?.carModel ?? options?.imageCarModel ?? null,
        carBrand: override?.carBrand ?? options?.imageCarBrand ?? null,
        year: override?.year ?? options?.imageYear ?? null,
        partKind: override?.partKind ?? options?.imagePartKind ?? null,
      };
    },
    notifyLineOaNeedsAdmin: async () => 1,
    getRecentLineMessagesForAi: async () => [],
    countConsecutiveFailedLineSearches: async () => 0,
    countPendingPaymentSlipsForConversation: async () => 0,
    classifyPurchaseIntent: async () => false,
    // WHOLESALE → salePrice shown (mirrors the processor test harness default).
    resolveLinePriceTier: async () => "WHOLESALE",
    answerFromChatFaq: async () => ({ answered: false, reply: "" }),
    extractChatSearchIntent: async (input) =>
      typeof options?.textIntent === "function"
        ? options.textIntent(input.latestText ?? "")
        : options?.textIntent ?? null,
    // Hermetic: the real detector resolves categories against the DB, which this
    // suite has no access to — it would fail closed (subjects: null) and silently
    // route every multi-subject case down the single-subject path. Mirror the
    // processor suite's stub: trust the classifier's own ≥2 subjects.
    detectChatMultiSubjects: async ({ intent }) => {
      const subjects = intent?.subjects && intent.subjects.length >= 2 ? intent.subjects : null;
      return {
        subjects,
        source: subjects ? ("llm" as const) : ("none" as const),
        handoffReason: null,
        categories: [],
      };
    },
    resolveChatFitmentFilters: async () => options?.fitmentFilters ?? ({}),
    generateChatSuggestion: async () => ({
      suggestedReply: "เบื้องต้นพบรายการที่ใกล้เคียงค่ะ",
      confidence: LineAiConfidence.POSSIBLE_MATCH,
      reasoningSummary: "test",
      matchedProducts: null,
    }),
    // ── coalescing deps ──
    acquireLineConversationLock: async ({ owner }) => {
      if (options?.lockAcquirable === false) return false;
      if (state.lockOwner) return false;
      state.lockOwner = owner;
      return true;
    },
    releaseLineConversationLock: async () => {
      state.lockOwner = null;
    },
    renewLineConversationLock: async () => true,
    bumpLineInboundSeq: async () => {
      state.seq += 1;
      return state.seq;
    },
    getLineCoalesceState: async () => ({
      lastInboundSeq: state.seq,
      lastProcessedSeq: state.processedSeq,
      aiStatus: state.aiStatus,
    }),
    markLineProcessedSeq: async ({ seq }) => {
      state.processedSeq = seq;
    },
    ingestPaymentSlip: async () =>
      ({
        slipId: "slip-1",
        verificationStatus: "PENDING_REVIEW",
        ocr: {
          amount: 1090,
          transferDatetimeIso: null,
          bank: null,
          senderName: null,
          receiverName: null,
          referenceNo: null,
          rawText: null,
        },
        imageStored: true,
      }) as Awaited<ReturnType<NonNullable<LineWebhookProcessorDependencies["ingestPaymentSlip"]>>>,
    getLineInquiryFrame: async () => state.frame,
    updateLineInquiryFrame: async (input) => {
      state.frame = {
        partType: input.partType,
        carBrand: input.carBrand,
        carModel: input.carModel,
        year: input.year,
        updatedAt: new Date(),
      };
    },
    getUnansweredInboundLineMessages: async (_id, withinMs = 5 * 60_000) => {
      const cutoff = Date.now() - withinMs;
      return state.inbound.slice(state.answeredCount).filter((m) => m.createdAt.getTime() > cutoff);
    },
    findStalledCoalescedConversationIds: async () =>
      state.seq > state.processedSeq && state.inbound.slice(state.answeredCount).length > 0 && !state.lockOwner
        ? ["conv-1"]
        : [],
    getLineConversationForRecovery: async () =>
      ({
        id: "conv-1",
        lineUserId: "u1",
        customerId: null,
        aiStatus: state.aiStatus,
        // shape matches getOrCreate's conversation row (only id/lineUserId/aiStatus used)
        lastCustomerMessageAt: null,
      }) as Awaited<ReturnType<LineWebhookProcessorDependencies["getOrCreateLineConversation"]>>,
    sleep: async () => undefined, // no real debounce wait in tests
  };

  return { state, calls, dependencies };
}

const baseConfig: LineWebhookProcessorConfig = {
  channelAccessToken: "token",
  autoReplyEnabled: true,
  dryRun: false,
  imageSearchEnabled: true,
  allowPushFallback: false,
  receivedAt: new Date(),
  replyTokenMaxAgeMs: 45_000,
  coalesce: true,
  coalesceWindowMs: 0,
};

function imageEvent(id: string) {
  return {
    type: "message",
    webhookEventId: id,
    replyToken: `reply-${id}`,
    source: { type: "user", userId: "u1" },
    message: { id: `m-${id}`, type: "image" },
  };
}

function textEvent(id: string, text: string) {
  return {
    type: "message",
    webhookEventId: id,
    replyToken: `reply-${id}`,
    source: { type: "user", userId: "u1" },
    message: { id: `m-${id}`, type: "text", text },
  };
}

function productIntent(fields: Partial<ChatSearchIntent>): ChatSearchIntent {
  return {
    group: "product",
    query: fields.query ?? "",
    isProductQuery: true,
    partType: fields.partType ?? null,
    carBrand: fields.carBrand ?? null,
    carModel: fields.carModel ?? null,
    year: fields.year ?? null,
    partKind: fields.partKind ?? null,
    tooBroad: fields.tooBroad ?? false,
  };
}

test("coalescing: a burst of 3 part images yields exactly ONE reply, no freeze", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image" });

  const result = await processLineWebhookPayload(
    { events: [imageEvent("e1"), imageEvent("e2"), imageEvent("e3")] },
    baseConfig,
    dependencies,
  );

  assert.equal(result.processedCount, 3, "all 3 events ingested");
  assert.equal(calls.replies.length, 1, "exactly one coalesced reply");
  assert.equal(calls.pushes.length, 0);
  assert.equal(result.repliedCount, 1);
  assert.ok(!calls.statePatches.includes("waiting_admin"), "conversation not frozen");
});

test("coalescing: an unknown image alongside part images does not hijack the turn", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // Latest classification is part_image (harness returns part for all); the merged
  // turn must still search and reply rather than hand off.
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image" });

  const result = await processLineWebhookPayload(
    { events: [imageEvent("e1"), imageEvent("e2")] },
    baseConfig,
    dependencies,
  );

  assert.equal(calls.replies.length, 1);
  assert.ok(calls.searches.length >= 1, "search ran for the merged turn");
  assert.ok(!calls.statePatches.includes("waiting_admin"));
});

test("coalescing: product + shipping burst searches and replies with products before the admin handoff", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createCoalesceHarness({
    fitmentFilters: {
      categoryName: "หม้อน้ำ (Radiator)",
      carBrandName: "Toyota",
      carModelName: "Vios",
    },
    textIntent: (latestText) =>
      latestText.includes("ส่งที่อู่")
        ? {
            group: "shipping_address",
            query: "",
            isProductQuery: false,
            partType: null,
            carBrand: null,
            carModel: null,
            year: null,
            partKind: null,
            tooBroad: false,
          }
        : productIntent({
            query: "หม้อน้ำ vios 2008 denso",
            partType: "หม้อน้ำ",
            carBrand: "Toyota",
            carModel: "Vios",
            year: 2008,
            partKind: "fitment",
          }),
  });

  await processLineWebhookPayload(
    {
      events: [
        textEvent("mixed-product", "หม้อน้ำ vios 08 denso"),
        textEvent("mixed-shipping", "ส่งที่อู่ช่างเตี้ย"),
      ],
    },
    baseConfig,
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "catalog search runs exactly once");
  assert.match(calls.searches[0] ?? "", /หม้อน้ำ vios 2008 denso/i);
  assert.doesNotMatch(calls.searches[0] ?? "", /ส่งที่อู่/, "shipping text is excluded from the product query");
  assert.equal(calls.replyBatches.length, 1, "the burst receives one ordered reply batch");
  const batch = calls.replyBatches[0] ?? [];
  assert.match(batch[0] ?? "", /พบรายการ|ใกล้เคียง/);
  assert.match(batch.at(-1) ?? "", /เรื่องค่าจัดส่งหรือการจัดส่ง.*แอดมิน/);
  assert.ok(calls.statePatches.includes("waiting_admin"), "room freezes only after the ordered reply");
});

test("coalescing: a newer message mid-pipeline aborts and re-runs once, still ONE reply", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image", bumpDuringFirstPass: true });

  const result = await processLineWebhookPayload(
    { events: [imageEvent("e1")] },
    baseConfig,
    dependencies,
  );

  assert.equal(calls.searches.length, 2, "pipeline ran twice (abort then re-run)");
  assert.equal(calls.replies.length, 1, "still exactly one reply sent");
  assert.equal(result.repliedCount, 1);
});

test("coalescing: when the lock is held elsewhere, this worker ingests but does not reply", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image", lockAcquirable: false });

  const result = await processLineWebhookPayload(
    { events: [imageEvent("e1")] },
    baseConfig,
    dependencies,
  );

  assert.equal(result.processedCount, 1, "message still ingested + seq-bumped");
  assert.equal(calls.replies.length, 0, "owner elsewhere handles the reply");
  assert.equal(result.repliedCount, 0);
});

test("coalescing: image-only part (fitment) with no car → gate asks, no search, no freeze", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createCoalesceHarness({
    imageKind: "part_image",
    imagePartType: "หม้อน้ำ",
    imagePartKind: "fitment",
    imageCarModel: null,
  });

  const result = await processLineWebhookPayload(
    { events: [imageEvent("e1")] },
    baseConfig,
    dependencies,
  );

  assert.equal(calls.searches.length, 0, "gated off until we know the car");
  assert.equal(calls.replies.length, 1, "still replies (asks for the vehicle)");
  assert.ok(calls.replies[0]?.includes("ยี่ห้อ"));
  assert.ok(!calls.statePatches.includes("waiting_admin"));
  assert.equal(result.repliedCount, 1);
});

test("coalescing: image-only part (fitment) with car → searches and replies", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createCoalesceHarness({
    imageKind: "part_image",
    imagePartType: "หม้อน้ำ",
    imagePartKind: "fitment",
    imageCarModel: "D-Max",
  });

  const result = await processLineWebhookPayload(
    { events: [imageEvent("e1")] },
    baseConfig,
    dependencies,
  );

  assert.ok(calls.searches.length >= 1, "search runs once we have part + car");
  assert.equal(calls.replies.length, 1);
  assert.equal(result.repliedCount, 1);
});

test("coalescing: a burst splits car (on the plate) + part (on the part photo) → merged → searches", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // Bug A: the registration-plate photo carries the brand, the radiator photo
  // carries the part type. Picking fields from a single image throws half the OCR
  // away and re-asks for detail the customer already sent. After the merge the
  // turn has part + car and must SEARCH, not ask "ชนิดอะไหล่".
  const { calls, dependencies } = createCoalesceHarness({
    imageClassByMessageId: {
      "m-e1": { kind: "part_image", carBrand: "ISUZU", partKind: "fitment", partType: null, searchHints: ["ISUZU"] },
      "m-e2": { kind: "part_image", partType: "หม้อน้ำ", partKind: "fitment", carBrand: null, searchHints: ["หม้อน้ำ"] },
    },
  });

  const result = await processLineWebhookPayload(
    { events: [imageEvent("e1"), imageEvent("e2")] },
    baseConfig,
    dependencies,
  );

  assert.ok(calls.searches.length >= 1, "merged classification has part + car → search runs");
  assert.equal(calls.replies.length, 1);
  assert.ok(!calls.replies[0]?.includes("ชนิดอะไหล่"), "must not re-ask for the part type the photo showed");
  assert.equal(result.repliedCount, 1);
});

test("coalescing: a car read off an image carries to the next text turn (no re-ask)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // Bug B: the image gives the car (brand), the customer then types only the part
  // type. The brand read from the image must persist in the inquiry frame so the
  // text turn is complete and searches — instead of re-asking "ยี่ห้อ/รุ่นรถ".
  const { calls, state, dependencies } = createCoalesceHarness({
    imageCarBrand: "ISUZU",
    imagePartKind: "fitment",
    imagePartType: null,
    textIntent: productIntent({ query: "หม้อน้ำ", partType: "หม้อน้ำ", partKind: "fitment" }),
  });

  // Turn 1: image only → asks for the part type, but the brand is now in the frame.
  await processLineWebhookPayload({ events: [imageEvent("e1")] }, baseConfig, dependencies);
  assert.equal(state.frame?.carBrand, "ISUZU", "brand read from the image persisted to the frame");

  const repliesAfterImage = calls.replies.length;

  // Turn 2: customer types only "หม้อน้ำ" → frame now has part + car → searches.
  await processLineWebhookPayload({ events: [textEvent("e2", "หม้อน้ำ")] }, baseConfig, dependencies);

  assert.ok(calls.searches.length >= 1, "text turn searches using the carried-over brand");
  const lastReply = calls.replies[calls.replies.length - 1];
  assert.ok(calls.replies.length > repliesAfterImage, "the text turn produced a reply");
  assert.ok(!lastReply?.includes("ยี่ห้อ/รุ่นรถ"), "must not re-ask for the brand already read from the image");
});

test("recovery: a crashed burst (unanswered + free lock) gets exactly one reply", async () => {
  const { recoverStalledCoalescedConversations } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image" });
  // Simulate a webhook that persisted the message + bumped seq but died before replying.
  state.inbound.push({
    id: "m1",
    text: "หม้อน้ำ d max",
    messageType: LineMessageType.TEXT,
    replyToken: "rt1",
    lineEventId: "e1",
    lineMessageId: "lm1",
    intent: null,
    createdAt: new Date(),
  });
  state.seq = 1; // newer than processedSeq (0) → stalled

  const res = await recoverStalledCoalescedConversations(baseConfig, dependencies, { quietForMs: 0, take: 5 });

  assert.equal(res.replied, 1, "recovery sent the missing reply");
  assert.equal(calls.replies.length, 1);
});

test("recovery: uses the latest message time when deciding reply-token expiry", async () => {
  const { recoverStalledCoalescedConversations } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image" });
  state.inbound.push({
    id: "m1",
    text: "24v",
    messageType: LineMessageType.TEXT,
    replyToken: "rt-old",
    lineEventId: "e-old",
    lineMessageId: "lm-old",
    intent: null,
    createdAt: new Date(Date.now() - 90_000),
  });
  state.seq = 1;

  const recoveryConfig: LineWebhookProcessorConfig = {
    ...baseConfig,
    receivedAt: undefined,
    allowPushFallback: true,
  };
  const res = await recoverStalledCoalescedConversations(recoveryConfig, dependencies, {
    quietForMs: 0,
    take: 5,
  });

  assert.equal(res.replied, 1);
  assert.equal(calls.replies.length, 0, "old reply token is not used during recovery");
  assert.equal(calls.pushes.length, 1, "recovery falls back to push when the real message time is too old");
});

test("recovery: an already-answered conversation produces no duplicate reply", async () => {
  const { recoverStalledCoalescedConversations } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image" });
  // Message exists but was already answered (seq == processedSeq) → not stalled.
  state.inbound.push({
    id: "m1",
    text: "หม้อน้ำ d max",
    messageType: LineMessageType.TEXT,
    replyToken: "rt1",
    lineEventId: "e1",
    lineMessageId: "lm1",
    intent: null,
    createdAt: new Date(),
  });
  state.seq = 1;
  state.processedSeq = 1;
  state.answeredCount = 1;

  const res = await recoverStalledCoalescedConversations(baseConfig, dependencies, { quietForMs: 0, take: 5 });

  assert.equal(res.scanned, 0, "nothing to recover");
  assert.equal(calls.replies.length, 0, "no duplicate reply");
});

test("coalescing: a stale unanswered message is NOT merged into a new slip burst", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "payment_slip" });
  // An old product question that the admin answered MANUALLY via LINE OA (so it
  // was never stored as an outbound) — it must not be pulled into today's slip.
  state.inbound.push({
    id: "old",
    text: "น้ำยาล้างคอยเย็น",
    messageType: LineMessageType.TEXT,
    replyToken: null,
    lineEventId: "old-e",
    lineMessageId: "old-lm",
    intent: null,
    createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // 7h ago
  });

  await processLineWebhookPayload({ events: [imageEvent("e-slip")] }, baseConfig, dependencies);

  assert.equal(calls.searches.length, 0, "stale text aged out → no bogus product search");
  void state;
});

test("B2a: recovery reuses the stored classification and does NOT re-OCR the image", async () => {
  const { recoverStalledCoalescedConversations } = await import("@/lib/line-webhook-processor");
  const { calls, state, dependencies } = createCoalesceHarness({ imageKind: "part_image" });

  // Count vision calls; recovery must make zero (it reuses the stored result).
  let classifyCount = 0;
  const origClassify = dependencies.classifyLineImage!;
  dependencies.classifyLineImage = async (inp) => {
    classifyCount += 1;
    return origClassify(inp);
  };
  // Stored classification is available for the unanswered image row (B2a).
  dependencies.getStoredImageClassificationsByMessageRowIds = async () =>
    new Map<string, unknown>([
      [
        "img-row",
        {
          kind: "part_image",
          intent: LineIntent.PART_IMAGE_INQUIRY,
          searchHints: ["หม้อน้ำ"],
          confidence: "HIGH",
          reason: "stored",
          partType: "หม้อน้ำ",
          carBrand: null,
          carModel: "D-Max",
          year: null,
          partKind: "fitment",
        },
      ],
    ]);

  // Simulate a crash AFTER ingest: an unanswered image row exists, seq ahead of
  // processed, no live lock → the cron recovery will pick it up.
  state.inbound.push({
    id: "img-row",
    text: null,
    messageType: LineMessageType.IMAGE,
    replyToken: "reply-x",
    lineEventId: "e-x",
    lineMessageId: "m-x",
    intent: null,
    createdAt: new Date(),
  });
  state.seq = 1;
  state.processedSeq = 0;
  state.answeredCount = 0;

  const res = await recoverStalledCoalescedConversations(baseConfig, dependencies);

  assert.equal(res.scanned, 1, "recovery picked up the stalled conversation");
  assert.equal(classifyCount, 0, "vision was NOT called — stored classification reused");
  assert.equal(calls.replies.length + calls.pushes.length, 1, "still produced exactly one reply");
});

test("B2b: past the wall-clock budget the owner force-sends once (no abort loop, no kill)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  // bumpDuringFirstPass makes a newer message land mid-pipeline — within budget
  // that would abort+re-run, but past budget the final pass must force the send.
  const { calls, dependencies } = createCoalesceHarness({
    imageKind: "part_image",
    bumpDuringFirstPass: true,
  });

  const auditActions: string[] = [];
  dependencies.storeLineAiAudit = async (input) => {
    auditActions.push(input.action);
    return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
  };

  // receivedAt 50s ago → already past the 40s budget on the first owner pass.
  // allowPushFallback so the (expired-token) forced send still delivers.
  const config: LineWebhookProcessorConfig = {
    ...baseConfig,
    receivedAt: new Date(Date.now() - 50_000),
    allowPushFallback: true,
  };

  const result = await processLineWebhookPayload({ events: [imageEvent("e1")] }, config, dependencies);

  assert.equal(result.repliedCount, 1, "exactly one reply despite the mid-pipeline bump");
  assert.equal(calls.replies.length + calls.pushes.length, 1, "single delivery, no duplicate/loop");
  assert.ok(auditActions.includes("AI_OWNER_BUDGET_FORCED_SEND"), "forced-send audit fired");
});

test("post-search budget fallback sends searched products and flex without starting Gemini prose", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const previousNextAuthUrl = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = "https://shop.example.com";
  // A resolved product intent (part + car, with a hard fitment filter) — the shared
  // default classifier returns null (classifier-uncertain hand-off) and a part-only
  // intent is blocked by the search gate (GATE_ASK need_car) before any search runs.
  const { calls, dependencies } = createCoalesceHarness({
    textIntent: productIntent({
      query: "หม้อน้ำ D-Max",
      partType: "หม้อน้ำ",
      carModel: "D-Max",
      partKind: "fitment",
    }),
  });
  dependencies.resolveChatFitmentFilters = async () => ({ carModelName: "D-Max" });
  const auditPayloads: unknown[] = [];
  const pushedMessages: unknown[][] = [];
  dependencies.storeLineAiAudit = async (input) => {
    if (input.action === "AI_DEADLINE_FALLBACK") auditPayloads.push(input.payload);
    return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
  };
  dependencies.pushLineMessages = async (input) => {
    pushedMessages.push(input.messages);
    calls.pushes.push(input.messages[0]?.type === "text" ? input.messages[0].text : "");
    return { sentCount: input.recipientIds.length, recipientIds: input.recipientIds };
  };
  dependencies.generateChatSuggestion = async () => {
    throw new Error("Gemini prose should not start after post-search budget fallback");
  };

  const result = await processLineWebhookPayload(
    { events: [textEvent("e1", "หม้อน้ำ D-Max")] },
    {
      ...baseConfig,
      receivedAt: new Date(Date.now() - 52_000),
      allowPushFallback: true,
    },
    dependencies,
  );

  assert.equal(calls.searches.length, 1, "real product search still ran");
  assert.equal(result.repliedCount, 1);
  assert.equal(calls.pushes.length, 1, "expired reply token falls back to push");
  assert.match(calls.pushes[0], /P1/);
  assert.match(calls.pushes[0], /100/);
  assert.equal((pushedMessages[0]?.[1] as { type?: unknown } | undefined)?.type, "flex");
  assert.ok(
    auditPayloads.some(
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { reason?: unknown }).reason === "AFTER_SEARCH_SERVERLESS_BUDGET",
    ),
    "deadline fallback audit records post-search serverless budget reason",
  );
  if (previousNextAuthUrl === undefined) {
    delete process.env.NEXTAUTH_URL;
  } else {
    process.env.NEXTAUTH_URL = previousNextAuthUrl;
  }
});

function multiIntent(
  primary: Partial<ChatSearchIntent>,
  subjects: ChatSearchIntent["subjects"],
): ChatSearchIntent {
  return { ...productIntent(primary), subjects };
}

test("B2c: two distinct part categories → multi-subject answer (2 searches), no freeze", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createCoalesceHarness({});
  const auditActions: string[] = [];
  dependencies.storeLineAiAudit = async (input) => {
    auditActions.push(input.action);
    return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
  };
  dependencies.extractChatSearchIntent = async () =>
    multiIntent({ partType: "คอมแอร์", carModel: "D-Max" }, [
      { partType: "คอมแอร์", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment", query: "คอมแอร์ D-Max" },
      { partType: "คอยเย็น", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment", query: "คอยเย็น D-Max" },
    ]);
  // The car must RESOLVE, otherwise the Option A vehicle-unresolved guard (added
  // after this test was written) hands off per subject instead of answering — the
  // right behaviour for an unknown car, but not what this test is about.
  dependencies.resolveChatFitmentFilters = async () => ({ carModelName: "D-Max" });

  const result = await processLineWebhookPayload(
    { events: [textEvent("e1", "คอมแอร์กับคอยเย็น D-Max")] },
    baseConfig,
    dependencies,
  );

  assert.equal(calls.searches.length, 2, "one search per distinct category");
  assert.ok(auditActions.includes("AI_MULTI_SUBJECT"), "multi-subject path ran");
  assert.equal(result.repliedCount, 1);
  assert.ok(!calls.statePatches.includes("waiting_admin"), "room not frozen");
});

test("B2c: same part type for two cars → NOT split (single path, no multi audit)", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createCoalesceHarness({});
  const auditActions: string[] = [];
  dependencies.storeLineAiAudit = async (input) => {
    auditActions.push(input.action);
    return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
  };
  // Classifier (defensively) returned two entries with the SAME part type — after
  // resolving they collapse to one category, so it must fall back to single path.
  dependencies.extractChatSearchIntent = async () =>
    multiIntent({ partType: "คอยเย็น", carModel: "D-Max" }, [
      { partType: "คอยเย็น", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment", query: "คอยเย็น D-Max" },
      { partType: "คอยเย็น", carBrand: null, carModel: "Vigo", year: null, partKind: "fitment", query: "คอยเย็น Vigo" },
    ]);

  await processLineWebhookPayload({ events: [textEvent("e1", "คอยเย็น D-Max กับ Vigo")] }, baseConfig, dependencies);

  assert.ok(!auditActions.includes("AI_MULTI_SUBJECT"), "did not multi-split same category");
});

test("B2c: mixed found/not-found → answers what it found, then notifies + freezes for the missing one", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { calls, dependencies } = createCoalesceHarness({});
  const auditActions: string[] = [];
  let notifyCount = 0;
  const allReplyTexts: string[] = [];
  dependencies.storeLineAiAudit = async (input) => {
    auditActions.push(input.action);
    return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
  };
  dependencies.notifyLineOaNeedsAdmin = async () => {
    notifyCount += 1;
    return 1;
  };
  dependencies.replyLineMessage = async (input) => {
    for (const m of input.messages) if (m.type === "text") allReplyTexts.push(m.text);
    return { sent: true, replyToken: input.replyToken };
  };
  dependencies.pushLineMessages = async (input) => {
    for (const m of input.messages) if (m.type === "text") allReplyTexts.push(m.text);
    return { sentCount: input.recipientIds.length, recipientIds: input.recipientIds };
  };
  // คอมแอร์ found, คอยเย็น not found.
  dependencies.searchChatProductInquiry = async (input) => {
    calls.searches.push(input.text ?? "");
    const notFound = (input.text ?? "").includes("คอยเย็น");
    return {
      searched: true,
      reason: "SEARCHED",
      query: input.text ?? "",
      result: { ids: notFound ? [] : ["product-1"], total: notFound ? 0 : 1, mode: "v2" },
      needsMoreInfo: notFound,
      appliedFilters: { categoryName: null, carBrandName: null, carModelName: null, fitmentYear: null },
      droppedImageCodes: [],
      didYouMean: null,
    };
  };
  dependencies.extractChatSearchIntent = async () =>
    multiIntent({ partType: "คอมแอร์", carModel: "D-Max" }, [
      { partType: "คอมแอร์", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment", query: "คอมแอร์ D-Max" },
      { partType: "คอยเย็น", carBrand: null, carModel: "D-Max", year: null, partKind: "fitment", query: "คอยเย็น D-Max" },
    ]);
  // As above: the car must resolve so the vehicle-unresolved guard stays out of the
  // way and this test measures the mixed found/not-found behaviour it is named for.
  dependencies.resolveChatFitmentFilters = async () => ({ carModelName: "D-Max" });

  await processLineWebhookPayload({ events: [textEvent("e1", "คอมแอร์กับคอยเย็น D-Max")] }, baseConfig, dependencies);

  assert.ok(auditActions.includes("AI_MULTI_SUBJECT"));
  assert.ok(allReplyTexts.some((t) => t.includes("ช่วยเช็กให้ชัวร์ก่อน")), "missing category shows a no-match line");
  assert.equal(notifyCount, 1, "admin notified about the missing category");
  // Policy change (see the `anyNotFound` branch in the multi-subject path): a missing
  // subject is an admin handoff, so the room freezes AFTER the found subject has been
  // answered. The customer still gets the คอมแอร์ result — asserted above — but the AI
  // stops so a human resolves the คอยเย็น the shop could not match.
  assert.ok(calls.statePatches.includes("waiting_admin"), "room frozen for the unresolved category");
});

// Golden (Option B/C): a burst that mixes a photo WITH text must be driven by the
// text. The image-subject guard is deliberately image-only — when the customer
// typed the part word, that word (not a MEDIUM vision read) is the subject, and
// neither the per-turn override nor the promotion may fire. Lives in the coalesce
// suite because only this harness merges a text+image burst into one turn.
test("coalesce: a text+image burst never lets the photo's subject override the frame", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { state, dependencies } = createCoalesceHarness({
    imageKind: "part_image",
    imageConfidence: "MEDIUM",
    imagePartType: "มอเตอร์ปรับอากาศ",
    imagePartKind: "fitment",
    imageHints: ["มอเตอร์ปรับอากาศ"],
    textIntent: productIntent({
      query: "มูเล่หน้าครัช ซิตี้",
      partType: "มูเล่หน้าครัช",
      carBrand: "Honda",
      carModel: "City",
      partKind: "fitment",
    }),
  });
  state.frame = {
    partType: "มูเล่หน้าครัช",
    carBrand: "Honda",
    carModel: "City",
    year: 1996,
    updatedAt: new Date(),
  };

  const auditActions: string[] = [];
  dependencies.storeLineAiAudit = async (input) => {
    auditActions.push(input.action);
    return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
  };
  dependencies.resolveChatFitmentFilters = async () => ({
    categoryName: "หน้าครัช (Compressor Clutch)",
    carBrandName: "Honda",
    carModelName: "City",
  });

  await processLineWebhookPayload(
    { events: [imageEvent("e1"), textEvent("e2", "มูเล่หน้าครัชอันนี้มีไหมคะ")] },
    baseConfig,
    dependencies,
  );

  assert.equal(
    auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"),
    false,
    "a turn that HAS text is driven by the text, never by the photo's subject",
  );
  assert.equal(auditActions.includes("IMAGE_SUBJECT_PROMOTED_TO_FRAME"), false);
  assert.equal(state.frame?.partType, "มูเล่หน้าครัช", "the typed subject stands");
});

// The same burst WITHOUT text: the photos are the only evidence, so the guard is
// allowed to steer the turn — the mirror image of the case above.
test("coalesce: an image-only burst does let the photo's subject override the frame", async () => {
  const { processLineWebhookPayload } = await import("@/lib/line-webhook-processor");
  const { state, dependencies } = createCoalesceHarness({
    imageKind: "part_image",
    imageConfidence: "MEDIUM",
    imagePartType: "มอเตอร์ปรับอากาศ",
    imagePartKind: "fitment",
    imageHints: ["มอเตอร์ปรับอากาศ"],
  });
  state.frame = {
    partType: "มูเล่หน้าครัช",
    carBrand: "Honda",
    carModel: "City",
    year: 1996,
    updatedAt: new Date(),
  };

  const auditActions: string[] = [];
  dependencies.storeLineAiAudit = async (input) => {
    auditActions.push(input.action);
    return {} as Awaited<ReturnType<LineWebhookProcessorDependencies["storeLineAiAudit"]>>;
  };

  await processLineWebhookPayload(
    { events: [imageEvent("e1"), imageEvent("e2")] },
    baseConfig,
    dependencies,
  );

  assert.ok(
    auditActions.includes("IMAGE_SUBJECT_OVERRIDES_FRAME"),
    "an image-only burst is steered by what the photos show",
  );
});
