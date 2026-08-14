import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { LineConversationAiStatus, LineMessageDirection, LineMessageType } from "@/lib/generated/prisma";

// The import graph reaches lib/db.ts, which throws without a connection string.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks — run via `npm run test:messenger-webhook`";

// Option A parity with LINE (2026-07-24, Honda Odyssey case): a customer names a car
// MODEL that never resolves to a hard model filter — even though the BRAND resolves —
// so a brand-only scoped search would surface other models' parts. Messenger must
// confirm the vehicle and hand off instead of searching.
test(
  "Messenger Option A: a named-but-unknown model on a known brand confirms the vehicle (does NOT search)",
  { skip: moduleMocksUnavailable },
  async () => {
    const calls = {
      searches: [] as Array<{ text?: string | null }>,
      textReplies: [] as string[],
    };
    let inboundSeq = 0;

    await mock.module("@/lib/messenger/messenger-conversation-repository", {
      namedExports: {
        DuplicateMessengerEventError: class DuplicateMessengerEventError extends Error {},
        acquireMessengerConversationLock: async () => true,
        appendMessengerMessage: async () => ({ id: "message-1" }),
        bumpMessengerInboundSeq: async () => {
          inboundSeq += 1;
          return inboundSeq;
        },
        escalateMessengerConversationToAdmin: async () => undefined,
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
        getRecentMessengerMessagesForAi: async () => [],
        getUnansweredMessengerMessages: async () => [
          {
            id: "inbound-1",
            text: "ฮอนด้าออดิซี่ กรองอากาศ",
            messageType: LineMessageType.TEXT,
            imageUrl: null,
            intent: null,
            createdAt: new Date(),
          },
        ],
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
          ids.map((id) => ({ id, code: id, name: `product ${id}`, salePrice: 100, imageUrl: null })),
        resolveCatalogCodes: async () => [],
        searchChatProductInquiry: async (input: { text?: string | null }) => {
          calls.searches.push({ text: input.text });
          return {
            searched: true,
            reason: "SEARCHED_PRODUCT_INQUIRY",
            query: input.text ?? "",
            result: { ids: ["id-1"], total: 1, mode: "v2", matchReasons: { "id-1": ["name"] } },
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
        // Grounded product intent: the customer named brand Honda + model Odyssey.
        extractChatSearchIntent: async () => ({
          group: "product",
          query: "กรองอากาศ Honda Odyssey",
          isProductQuery: true,
          partType: "กรองอากาศ",
          carBrand: "Honda",
          carModel: "Odyssey",
          year: null,
          partKind: "fitment",
          tooBroad: false,
        }),
      },
    });

    await mock.module("@/lib/chat-core/fitment-resolve", {
      namedExports: {
        // Category + brand resolve, but the model does NOT → carModelName stays null.
        resolveChatFitmentFilters: async () => ({
          categoryName: "กรองอากาศ (Air Filter)",
          carBrandName: "Honda",
        }),
      },
    });

    await mock.module("@/lib/chat-core/multi-subject-detector", {
      namedExports: {
        detectChatMultiSubjects: async () => ({ subjects: null, source: "none", handoffReason: null, categories: [] }),
      },
    });

    await mock.module("@/lib/car-brand-alias-loader", {
      namedExports: { loadCarBrandVariantLookup: async () => new Map<string, string[]>([["honda", ["honda", "ฮอนด้า"]]]) },
    });
    await mock.module("@/lib/car-model-alias-loader", {
      namedExports: {
        loadCarModelVariantLookup: async () =>
          new Map<string, string[]>([["odyssey", ["odyssey", "ออดิซี่", "honda odyssey"]]]),
        loadCarModelGroundingLookup: async () => new Map(),
      },
    });

    await mock.module("@/lib/messenger/messenger-messaging", {
      namedExports: {
        fetchMessengerUserProfile: async () => null,
        sendMessengerGenericTemplate: async () => undefined,
        sendMessengerSenderAction: async () => undefined,
        sendMessengerText: async (input: { text: string }) => {
          calls.textReplies.push(input.text);
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

    const { processMessengerBatch } = await import("@/lib/messenger/messenger-webhook-processor");

    await processMessengerBatch(
      [
        {
          pageId: "page-1",
          psid: "psid-1",
          mid: "mid-1",
          fbEventId: "event-1",
          text: "ฮอนด้าออดิซี่ กรองอากาศ",
          hasAttachment: false,
          attachmentUrls: [],
        },
      ],
      { pageAccessToken: "token" },
    );

    assert.equal(calls.searches.length, 0, "unresolved model on a known brand must not run a brand-only search");
    assert.ok(
      calls.textReplies.some((t) => t.includes("ยืนยัน")),
      "asks the customer to confirm the vehicle (vehicle-unresolved handoff)",
    );
  },
);
