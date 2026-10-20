import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { LineConversationAiStatus, LineMessageDirection, LineMessageType } from "@/lib/generated/prisma";
import { buildCarModelGroundingLookup, buildCarModelVariantLookup } from "@/lib/car-model-alias-cache";
import { buildChatVehicleConfirmPrompt } from "@/lib/chat-core/vehicle-mention-conflict";
import { CAR_MODEL_SYNONYM_ROWS_2026_10_20 } from "@/lib/__tests__/fixtures/car-model-synonyms-2026-10-20";

// The import graph reaches lib/db.ts, which throws without a connection string.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks — run via `npm run test:messenger-webhook`";

// Messenger parity for the LINE incident of 2026-10-20 ("คอยเย็นซี๊ดตี้09" read as Ford
// Fiesta): the conflicting model is dropped, the customer is asked "หมายถึง Honda City
// ใช่ไหมคะ", and a "ใช่" replays the original question with the confirmed car.

type StoredRow = { id: string; direction: LineMessageDirection; text: string; createdAt: Date };

const state = {
  unanswered: [] as string[],
  recent: [] as StoredRow[],
  searches: [] as Array<{ text?: string | null; fitmentHints?: unknown }>,
  textReplies: [] as string[],
  classifierTexts: [] as Array<string | null | undefined>,
  fitmentModels: [] as Array<string | null | undefined>,
  events: [] as Array<{ action: string; payload: Record<string, unknown> }>,
  escalations: 0,
};

const resetTurn = (unanswered: string[], recent: Array<["c" | "s", string]>) => {
  const start = Date.now() - (recent.length + 1) * 60_000;
  state.unanswered = unanswered;
  state.recent = recent.map(([role, text], index) => ({
    id: `row-${index + 1}`,
    direction: role === "c" ? LineMessageDirection.INBOUND : LineMessageDirection.OUTBOUND_AI,
    text,
    createdAt: new Date(start + index * 60_000),
  }));
  state.searches = [];
  state.textReplies = [];
  state.classifierTexts = [];
  state.fitmentModels = [];
  state.events = [];
  state.escalations = 0;
};

let inboundSeq = 0;

before(async () => {
  if (moduleMocksUnavailable) return;

  await mock.module("@/lib/messenger/messenger-conversation-repository", {
    namedExports: {
      DuplicateMessengerEventError: class DuplicateMessengerEventError extends Error {},
      acquireMessengerConversationLock: async () => true,
      appendMessengerMessage: async () => ({ id: "message-1" }),
      bumpMessengerInboundSeq: async () => {
        inboundSeq += 1;
        return inboundSeq;
      },
      escalateMessengerConversationToAdmin: async () => {
        state.escalations += 1;
      },
      findStalledMessengerConversationIds: async () => [],
      getMessengerCoalesceState: async () => ({
        lastInboundSeq: inboundSeq,
        lastProcessedSeq: 0,
        aiStatus: LineConversationAiStatus.ACTIVE,
      }),
      getMessengerConversationPsid: async () => "psid-1",
      getOrCreateMessengerConversation: async () => ({
        conversation: { id: "conversation-1", aiStatus: LineConversationAiStatus.ACTIVE, displayName: "FB User" },
        created: false,
      }),
      // Messenger stores the burst before replying, so it is already in history.
      getRecentMessengerMessagesForAi: async () => [
        ...state.recent.map((row) => ({ ...row, messageType: LineMessageType.TEXT })),
        ...state.unanswered.map((text, index) => ({
          id: `inbound-${index + 1}`,
          direction: LineMessageDirection.INBOUND,
          text,
          messageType: LineMessageType.TEXT,
          createdAt: new Date(),
        })),
      ],
      getUnansweredMessengerMessages: async () =>
        state.unanswered.map((text, index) => ({
          id: `inbound-${index + 1}`,
          text,
          messageType: LineMessageType.TEXT,
          imageUrl: null,
          intent: null,
          createdAt: new Date(),
        })),
      markMessengerProcessedSeq: async () => undefined,
      releaseMessengerConversationLock: async () => undefined,
      resolveMessengerPriceTier: async () => "RETAIL",
      storeMessengerAiSuggestion: async () => ({ id: "suggestion-1" }),
    },
  });

  await mock.module("@/lib/chat-core/product-search-bridge", {
    namedExports: {
      applyChatPriceTier: <T,>(products: T[]) => products,
      getChatProductSummaries: async (ids: string[]) =>
        ids.map((id) => ({ id, code: id, name: `คอยล์เย็น Honda City ${id}`, salePrice: 100, imageUrl: null })),
      resolveCatalogCodes: async () => [],
      searchChatProductInquiry: async (input: { text?: string | null; fitmentHints?: unknown }) => {
        state.searches.push({ text: input.text, fitmentHints: input.fitmentHints });
        return {
          searched: true,
          reason: "SEARCHED_PRODUCT_INQUIRY",
          query: input.text ?? "",
          result: { ids: ["P0053"], total: 1, mode: "v2", matchReasons: { P0053: ["name"] } },
          needsMoreInfo: false,
          appliedFilters: { categoryName: null, carBrandName: null, carModelName: null, fitmentYear: null },
          droppedImageCodes: [],
          didYouMean: null,
        };
      },
    },
  });

  await mock.module("@/lib/chat-core/ai-service", {
    namedExports: {
      generateChatSuggestion: async () => ({ suggestedReply: "x", confidence: "POSSIBLE_MATCH", reasoningSummary: "t" }),
      generateScopedConversationalReply: async () => "scoped reply",
      // Gemini's reading in production — and it repeats it on the replayed question.
      extractChatSearchIntent: async (input: { latestText?: string | null }) => {
        state.classifierTexts.push(input.latestText);
        return {
          group: "product",
          query: "คอยเย็น ซี๊ดตี้ 2009",
          isProductQuery: true,
          partType: "คอยเย็น",
          carBrand: "Ford",
          carModel: "Fiesta",
          carMentionInLatest: "ซี๊ดตี้",
          year: 2009,
          partKind: "fitment",
          tooBroad: false,
        };
      },
    },
  });

  await mock.module("@/lib/chat-core/fitment-resolve", {
    namedExports: {
      resolveChatFitmentFilters: async (input: { partType?: string | null; carModel?: string | null }) => {
        state.fitmentModels.push(input.carModel);
        const model = (input.carModel ?? "").toLowerCase();
        const car = model.includes("city")
          ? { carBrandName: "Honda", carModelName: "City" }
          : model.includes("fiesta")
            ? { carBrandName: "Ford", carModelName: "Fiesta" }
            : {};
        return { ...(input.partType ? { categoryName: "คอยล์เย็น (Evaporator)" } : {}), ...car };
      },
    },
  });

  await mock.module("@/lib/chat-core/multi-subject-detector", {
    namedExports: {
      detectChatMultiSubjects: async () => ({ subjects: null, source: "none", handoffReason: null, categories: [] }),
    },
  });

  await mock.module("@/lib/car-brand-alias-loader", {
    namedExports: { loadCarBrandVariantLookup: async () => new Map<string, string[]>() },
  });
  const modelLookup = buildCarModelVariantLookup(CAR_MODEL_SYNONYM_ROWS_2026_10_20);
  const groundingLookup = buildCarModelGroundingLookup(CAR_MODEL_SYNONYM_ROWS_2026_10_20);
  await mock.module("@/lib/car-model-alias-loader", {
    namedExports: {
      loadCarModelVariantLookup: async () => modelLookup,
      loadCarModelGroundingLookup: async () => groundingLookup,
    },
  });

  await mock.module("@/lib/chat-core/vehicle-mention-telemetry", {
    namedExports: {
      logMessengerVehicleMentionEvent: async (input: { action: string; payload: Record<string, unknown> }) => {
        state.events.push({ action: input.action, payload: input.payload });
      },
    },
  });

  await mock.module("@/lib/messenger/messenger-messaging", {
    namedExports: {
      fetchMessengerUserProfile: async () => null,
      sendMessengerGenericTemplate: async () => undefined,
      sendMessengerSenderAction: async () => undefined,
      sendMessengerText: async (input: { text: string }) => {
        state.textReplies.push(input.text);
      },
    },
  });

  await mock.module("@/lib/notifications", {
    namedExports: {
      notifyMessengerNeedsAdmin: async () => undefined,
      notifyMessengerNewConversation: async () => undefined,
      notifyMessengerPaymentSlip: async () => undefined,
    },
  });

  await mock.module("@/lib/messenger/messenger-image-service", {
    namedExports: {
      classifyMessengerImage: async () => ({ classification: { kind: "unknown" }, content: Buffer.alloc(0) }),
      ingestMessengerPaymentSlip: async () => undefined,
    },
  });
});

async function runTurn(texts: string[]): Promise<void> {
  const { processMessengerBatch } = await import("@/lib/messenger/messenger-webhook-processor");
  await processMessengerBatch(
    texts.map((text, index) => ({
      pageId: "page-1",
      psid: "psid-1",
      mid: `mid-${Date.now()}-${index}`,
      fbEventId: `event-${Date.now()}-${index}`,
      text,
      hasAttachment: false,
      attachmentUrls: [],
    })),
    { pageAccessToken: "token" },
  );
}

test(
  "Messenger 2026-10-20 parity: the incident turn asks \"หมายถึง Honda City ใช่ไหมคะ\" and never searches Fiesta",
  { skip: moduleMocksUnavailable },
  async () => {
    resetTurn(["คอยเย็นซี๊ดตี้09", "มีไหมคับ"], []);

    await runTurn(["คอยเย็นซี๊ดตี้09", "มีไหมคับ"]);

    assert.equal(state.searches.length, 0, "no Mazda 2 / Fiesta coils for a City");
    assert.equal(state.textReplies.length, 1);
    assert.match(state.textReplies[0] ?? "", /"ซี๊ดตี้" หมายถึง Honda City ใช่ไหมคะ/);
    assert.equal(state.escalations, 0, "a question, not a hand-off");
    assert.deepEqual(state.events, [
      {
        action: "VEHICLE_MENTION_CONFLICT",
        payload: { mention: "ซี๊ดตี้", classifierModel: "Fiesta", suggestion: "Honda City", suggestionDistance: 2 },
      },
    ]);
  },
);

test(
  "Messenger 2026-10-20 parity: \"ใช่คับ\" replays the question and searches Honda City coils",
  { skip: moduleMocksUnavailable },
  async () => {
    resetTurn(
      ["ใช่คับ"],
      [
        ["c", "คอยเย็นซี๊ดตี้09"],
        ["c", "มีไหมคับ"],
        ["s", buildChatVehicleConfirmPrompt({ mention: "ซี๊ดตี้", vehicleLabel: "Honda City" })],
      ],
    );

    await runTurn(["ใช่คับ"]);

    assert.deepEqual(state.classifierTexts, ["คอยเย็นซี๊ดตี้ 09 มีไหมคับ Honda City"], "the original question is replayed");
    assert.deepEqual(state.events, [
      { action: "VEHICLE_CONFIRMATION_ACCEPTED", payload: { mention: "ซี๊ดตี้", vehicleLabel: "Honda City" } },
    ]);
    assert.equal(state.searches.length, 1);
    assert.deepEqual(state.searches[0]?.fitmentHints, {
      categoryName: "คอยล์เย็น (Evaporator)",
      carBrandName: "Honda",
      carModelName: "City",
      fitmentYear: 2009,
    });
    assert.ok(state.fitmentModels.every((model) => !/fiesta/i.test(model ?? "")), "Fiesta is never resolved");
  },
);

test(
  "Messenger: a bare \"ไม่ใช่ครับ\" after the question asks which car and searches nothing",
  { skip: moduleMocksUnavailable },
  async () => {
    resetTurn(
      ["ไม่ใช่ครับ"],
      [
        ["c", "คอยเย็นซี๊ดตี้09"],
        ["c", "มีไหมคับ"],
        ["s", buildChatVehicleConfirmPrompt({ mention: "ซี๊ดตี้", vehicleLabel: "Honda City" })],
      ],
    );

    await runTurn(["ไม่ใช่ครับ"]);

    assert.deepEqual(state.classifierTexts, ["คอยเย็นซี๊ดตี้ 09 มีไหมคับ"], "the original question, without a car");
    assert.equal(state.events[0]?.action, "VEHICLE_CONFIRMATION_REJECTED");
    assert.equal(state.searches.length, 0);
    assert.equal(state.textReplies.length, 1);
    assert.match(state.textReplies[0] ?? "", /จูนยังไม่แน่ใจว่า "ซี๊ดตี้" หมายถึงรถรุ่นไหน/);
    assert.equal(state.escalations, 0);
  },
);
