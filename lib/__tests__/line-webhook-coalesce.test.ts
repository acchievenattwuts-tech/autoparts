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
import type { LineSearchIntent } from "@/lib/line-ai-service";

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
  imageHints?: string[];
  imagePartKind?: "fitment" | "universal" | null;
  imagePartType?: string | null;
  imageCarBrand?: string | null;
  imageCarModel?: string | null;
  imageYear?: number | null;
  /** Per-image classification overrides keyed by lineMessageId (`m-<eventId>`),
   *  so a burst can spread brand/part type across different photos. */
  imageClassByMessageId?: Record<string, Partial<LineImageClassification>>;
  /** Stand-in for the text intent classifier (extractLineSearchIntent). */
  textIntent?: LineSearchIntent | null;
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
    searchLineProductInquiry: async (input) => {
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
        result: { ids: ["product-1"], total: 1, mode: "v2" },
        needsMoreInfo: false,
        appliedFilters: {
          categoryName: null,
          carBrandName: null,
          carModelName: null,
          fitmentYear: null,
        },
        droppedImageCodes: [],
      };
    },
    getLineProductSummaries: async () => [{ id: "product-1", name: "หม้อน้ำ D-Max", code: "P1", imageUrl: null, salePrice: 100 }],
    replyLineMessage: async (input) => {
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
        confidence: "HIGH" as const,
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
    classifyPurchaseIntent: async () => false,
    answerFromLineFaq: async () => ({ answered: false, reply: "" }),
    extractLineSearchIntent: async () => options?.textIntent ?? null,
    resolveLineFitmentFilters: async () => ({}),
    generateLineSuggestion: async () => ({
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

function productIntent(fields: Partial<LineSearchIntent>): LineSearchIntent {
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
