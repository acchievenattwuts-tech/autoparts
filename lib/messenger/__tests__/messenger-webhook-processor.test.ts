import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  LineAiConfidence,
  LineConversationAiStatus,
  LineIntent,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";

test("Messenger normalizes glued model-year queries and hands off product no-matches", async () => {
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
          text: "คอยเย็น Jazz08-12",
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
      searchChatProductInquiry: async (input: { text?: string | null }) => {
        calls.searches.push({ text: input.text });
        return {
          searched: true,
          reason: "SEARCHED_PRODUCT_INQUIRY",
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
        text: "คอยเย็น Jazz08-12",
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.equal(calls.searches.length, 1);
  assert.equal(calls.searches[0]?.text, "คอยเย็น Jazz 08-12");
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.aiSuggestions.length, 0);
  assert.equal(calls.outboundMessages.length, 1);
  assert.ok(calls.textReplies[0]?.includes("แอดมิน"));
  assert.deepEqual(calls.processedSeqs, [1]);
});
