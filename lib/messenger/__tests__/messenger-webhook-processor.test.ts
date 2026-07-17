import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  LineAiConfidence,
  LineConversationAiStatus,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";

// The import graph reaches lib/db.ts, which throws without a connection string.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

// `mock.module` only exists when node runs with --experimental-test-module-mocks
// (use `npm run test:messenger-webhook`). Skip instead of crashing when a plain
// `npx tsx --test` sweep picks this file up without the flag.
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks — run via `npm run test:messenger-webhook`";

test(
  "Messenger maps a 14-inch push fan and uses the safe shared no-match handoff",
  { skip: moduleMocksUnavailable },
  async () => {
  const calls = {
    searches: [] as Array<{ text?: string | null }>,
    textReplies: [] as string[],
    escalations: [] as string[],
    notifications: [] as Array<{ text?: string | null }>,
    aiSuggestions: [] as Array<{ originalText: string }>,
    outboundMessages: [] as string[],
    processedSeqs: [] as number[],
  };

  let inboundSeq = 0;
  const inboundCreatedAt = new Date();

  await mock.module("@/lib/messenger/messenger-conversation-repository", {
    namedExports: {
      DuplicateMessengerEventError: class DuplicateMessengerEventError extends Error {},
      acquireMessengerConversationLock: async () => true,
      appendMessengerMessage: async (input: {
        direction: LineMessageDirection;
        text?: string | null;
      }) => {
        if (input.direction === LineMessageDirection.OUTBOUND_AI) {
          calls.outboundMessages.push(input.text ?? "");
        }
        return { id: "message-1" };
      },
      bumpMessengerInboundSeq: async () => {
        inboundSeq += 1;
        return inboundSeq;
      },
      escalateMessengerConversationToAdmin: async (conversationId: string) => {
        calls.escalations.push(conversationId);
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
      getRecentMessengerMessagesForAi: async () => [],
      getUnansweredMessengerMessages: async () => [
        {
          id: "inbound-1",
          text: "พัดลมเป่า 14นิ้วมีไหมคับ",
          messageType: LineMessageType.TEXT,
          imageUrl: null,
          intent: null,
          createdAt: inboundCreatedAt,
        },
      ],
      markMessengerProcessedSeq: async ({ seq }: { seq: number }) => {
        calls.processedSeqs.push(seq);
      },
      releaseMessengerConversationLock: async () => undefined,
      resolveMessengerPriceTier: async () => "RETAIL",
      storeMessengerAiSuggestion: async () => ({ id: "suggestion-1" }),
    },
  });

  await mock.module("@/lib/chat-core/product-search-bridge", {
    namedExports: {
      applyChatPriceTier: <T>(products: T[]) => products,
      getChatProductSummaries: async () => [],
      searchChatProductInquiry: async (input: {
        text?: string | null;
        fitmentHints?: { categoryName?: string | null } | null;
      }) => {
        calls.searches.push({ text: input.text });
        assert.equal(input.fitmentHints?.categoryName, "ใบพัดลม (Cooling Fan Blade)");
        return {
          searched: true,
          reason: "SEARCHED_PRODUCT_SPEC_NO_MATCH",
          query: input.text ?? "",
          result: { ids: [], total: 0, mode: "v2" },
          needsMoreInfo: true,
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
    },
  });

  await mock.module("@/lib/chat-core/ai-service", {
    namedExports: {
      generateChatSuggestion: async (input: { originalText: string }) => {
        calls.aiSuggestions.push(input);
        return {
          suggestedReply: "FAQ should not answer this product no-match",
          confidence: LineAiConfidence.ADMIN_REQUIRED,
          reasoningSummary: "test",
        };
      },
      generateScopedConversationalReply: async () => "scoped reply",
      extractChatSearchIntent: async () => ({
        group: "product",
        query: "พัดลมเป่า 14 นิ้ว",
        isProductQuery: true,
        partType: "พัดลม",
        carBrand: null,
        carModel: null,
        year: null,
        partKind: "fitment",
        tooBroad: false,
      }),
      buildJuneTextNoMatchHandoffReply: (known?: { partType?: string | null } | null) =>
        `สำหรับ${known?.partType ?? "รายการที่แจ้ง"} จูนขอให้แอดมินช่วยเช็กสต็อกและตัวที่เข้ากันให้ชัวร์ก่อนนะคะ`,
    },
  });

  await mock.module("@/lib/chat-core/fitment-resolve", {
    namedExports: {
      resolveChatFitmentFilters: async () => ({
        categoryName: "ใบพัดลม (Cooling Fan Blade)",
      }),
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
      notifyMessengerNeedsAdmin: async (input: { text?: string | null }) => {
        calls.notifications.push({ text: input.text });
      },
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
        text: "พัดลมเป่า 14นิ้วมีไหมคับ",
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.equal(calls.searches.length, 1);
  assert.equal(calls.searches[0]?.text, "พัดลมเป่า 14 นิ้วมีไหมคับ");
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.aiSuggestions.length, 0);
  assert.equal(calls.outboundMessages.length, 1);
  assert.ok(calls.textReplies[0]?.includes("แอดมิน"));
  assert.ok(calls.textReplies[0]?.includes("พัดลม แบบเป่า 14 นิ้ว"));
  assert.doesNotMatch(
    calls.textReplies[0] ?? "",
    /ไม่มีสินค้า|ไม่มีของ|หาไม่เจอ|ไม่พบสินค้า|ยังไม่พบ/,
  );
  assert.deepEqual(calls.processedSeqs, [1]);
});
