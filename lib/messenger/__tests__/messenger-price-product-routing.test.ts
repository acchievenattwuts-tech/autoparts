import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  LineAiConfidence,
  LineConversationAiStatus,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
import {
  buildPriceProductSearchIntent,
  extractPriceProductSubjectsFromText,
} from "@/lib/chat-core/price-product-subjects";

test("price product subject helper extracts the three subjects from the LINE/Messenger price case", () => {
  const subjects = extractPriceProductSubjectsFromText(
    [
      "ตู้วีโก้คลูเกีรยคับน้ำDENSO250ccราคาคับ",
      "น้ำมัน",
      "ที่ร้านมีน้ำยาแอร์ของอะไรคับขอราคาด้วยคับ",
    ].join("\n"),
  );

  assert.ok(subjects.some((subject) => /Vigo|วีโก้/i.test(subject.query ?? "")));
  assert.ok(subjects.some((subject) => /DENSO/i.test(subject.query ?? "")));
  assert.equal(subjects.length, 3, JSON.stringify(subjects));

  const intent = buildPriceProductSearchIntent(subjects);
  assert.equal(intent?.group, "product");
  assert.equal(intent?.subjects?.length, 3);
});

test("price product subject helper returns no subjects for bare price-only text", () => {
  const subjects = extractPriceProductSubjectsFromText("ราคาเท่าไรครับ ต่อได้ไหม");

  assert.deepEqual(subjects, []);
  assert.equal(buildPriceProductSearchIntent(subjects), null);
});

test("price product subject helper does not guess from uncertain typo-heavy text", () => {
  const subjects = extractPriceProductSubjectsFromText("DENSO250cc ราคาเท่าไรครับ");

  assert.deepEqual(subjects, []);
  assert.equal(buildPriceProductSearchIntent(subjects), null);
});

async function setupMessengerPriceRoutingTest(unansweredText: string) {
  const calls = {
    searches: [] as Array<{ text?: string | null }>,
    textReplies: [] as string[],
    escalations: [] as string[],
    outboundMessages: [] as string[],
  };
  let inboundSeq = 0;
  const inboundCreatedAt = new Date();

  await mock.module("@/lib/messenger/messenger-conversation-repository", {
    namedExports: {
      DuplicateMessengerEventError: class DuplicateMessengerEventError extends Error {},
      acquireMessengerConversationLock: async () => true,
      appendMessengerMessage: async (input: { direction: LineMessageDirection; text?: string | null }) => {
        if (input.direction === LineMessageDirection.OUTBOUND_AI) calls.outboundMessages.push(input.text ?? "");
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
          text: unansweredText,
          messageType: LineMessageType.TEXT,
          imageUrl: null,
          intent: null,
          createdAt: inboundCreatedAt,
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
      applyChatPriceTier: <T>(products: T[]) => products,
      getChatProductSummaries: async (ids: string[]) =>
        ids.map((id) => ({ id, code: id, name: `product ${id}`, salePrice: 100, imageUrl: null })),
      resolveCatalogCodes: async () => [],
      searchChatProductInquiry: async (input: { text?: string | null }) => {
        calls.searches.push({ text: input.text });
        return {
          searched: true,
          reason: "SEARCHED_PRODUCT_INQUIRY",
          query: input.text ?? "",
          result: { ids: [`id-${calls.searches.length}`], total: 1, mode: "v2" },
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
    },
  });

  await mock.module("@/lib/chat-core/ai-service", {
    namedExports: {
      generateChatSuggestion: async () => ({
        suggestedReply: "พบสินค้าใกล้เคียงค่ะ",
        confidence: LineAiConfidence.POSSIBLE_MATCH,
        reasoningSummary: "test",
      }),
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

  return calls;
}

test.skip("Messenger price turn with three product subjects searches each subject before admin handoff", async () => {
  const calls = await setupMessengerPriceRoutingTest(
    [
      "ตู้วีโก้คลูเกีรยคับน้ำDENSO250ccราคาคับ",
      "น้ำมัน",
      "ที่ร้านมีน้ำยาแอร์ของอะไรคับขอราคาด้วยคับ",
    ].join("\n"),
  );
  const { processMessengerBatch } = await import("@/lib/messenger/messenger-webhook-processor");

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-1",
        fbEventId: "event-1",
        text: calls.searches.length.toString(),
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.equal(calls.searches.length, 3);
  assert.ok(calls.searches.some((call) => /Vigo|วีโก้/i.test(call.text ?? "")));
  assert.ok(calls.searches.some((call) => /DENSO/i.test(call.text ?? "")));
  assert.ok(calls.searches.some((call) => /น้ำยาแอร์/i.test(call.text ?? "")));
  assert.deepEqual(calls.escalations, ["conversation-1"]);
});

test.skip("Messenger bare price-only turn does not resurrect old product context into search", async () => {
  const calls = await setupMessengerPriceRoutingTest("ราคาเท่าไรครับ");
  const { processMessengerBatch } = await import("@/lib/messenger/messenger-webhook-processor");

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-1",
        fbEventId: "event-1",
        text: "ราคาเท่าไรครับ",
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.equal(calls.searches.length, 0);
  assert.deepEqual(calls.escalations, ["conversation-1"]);
});
