import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  LineAiConfidence,
  LineConversationAiStatus,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
// Loaded for real before the ai-service mock below, so the mock can reuse the
// deterministic hand-off wording instead of re-implementing it.
import { buildJuneTextNoMatchHandoffReply } from "@/lib/chat-core/ai-service";
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

type SearchFitmentHints = {
  categoryName?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  fitmentYear?: number | null;
} | null;

type RoutingCalls = {
  searches: Array<{ text?: string | null; fitmentHints?: SearchFitmentHints }>;
  textReplies: string[];
  escalations: string[];
  outboundMessages: string[];
};

let activeCalls: RoutingCalls;
let activeUnansweredText = "";
let inboundSeq = 0;
let mocksInstalled = false;

async function setupMessengerPriceRoutingTest(unansweredText: string) {
  const calls = {
    searches: [] as Array<{ text?: string | null; fitmentHints?: SearchFitmentHints }>,
    textReplies: [] as string[],
    escalations: [] as string[],
    outboundMessages: [] as string[],
  };
  activeCalls = calls;
  activeUnansweredText = unansweredText;
  inboundSeq = 0;
  const inboundCreatedAt = new Date();

  if (mocksInstalled) return calls;

  const emptyModel = new Proxy({}, {
    get: () => async () => [],
  });
  const dbStub = new Proxy({}, {
    get: () => emptyModel,
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: dbStub,
      dbTx: async (callback: (tx: unknown) => unknown) => callback(dbStub),
    },
  });

  await mock.module("@/lib/messenger/messenger-conversation-repository", {
    namedExports: {
      DuplicateMessengerEventError: class DuplicateMessengerEventError extends Error {},
      acquireMessengerConversationLock: async () => true,
      appendMessengerMessage: async (input: { direction: LineMessageDirection; text?: string | null }) => {
        if (input.direction === LineMessageDirection.OUTBOUND_AI) activeCalls.outboundMessages.push(input.text ?? "");
        return { id: "message-1" };
      },
      bumpMessengerInboundSeq: async () => {
        inboundSeq += 1;
        return inboundSeq;
      },
      escalateMessengerConversationToAdmin: async (conversationId: string) => {
        activeCalls.escalations.push(conversationId);
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
          text: activeUnansweredText,
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
      buildUnlinkedPriceNote: () => null,
      CHAT_PRODUCT_DISPLAY_LIMIT: 8,
      CHAT_PRODUCT_FETCH_LIMIT: 20,
      getChatProductSummaries: async (ids: string[]) =>
        ids.map((id) => ({ id, code: id, name: `product ${id}`, salePrice: 100, imageUrl: null })),
      resolveCatalogCodes: async () => [],
      searchChatProductInquiry: async (input: { text?: string | null; fitmentHints?: SearchFitmentHints }) => {
        activeCalls.searches.push({ text: input.text, fitmentHints: input.fitmentHints ?? null });
        const id = `id-${activeCalls.searches.length}`;
        return {
          searched: true,
          reason: "SEARCHED_PRODUCT_INQUIRY",
          query: input.text ?? "",
          // The real engine always reports per-id match reasons; a strong name match
          // keeps the category-less relevance gate from handing these rows off.
          result: { ids: [id], total: 1, mode: "v2", matchReasons: { [id]: ["name"] } },
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
      buildJuneTextNoMatchHandoffReply,
    },
  });

  await mock.module("@/lib/messenger/messenger-messaging", {
    namedExports: {
      fetchMessengerUserProfile: async () => null,
      sendMessengerGenericTemplate: async () => undefined,
      sendMessengerSenderAction: async () => undefined,
      sendMessengerText: async (input: { text: string }) => {
        activeCalls.textReplies.push(input.text);
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

  mocksInstalled = true;
  return calls;
}

test("Messenger price turn with three product subjects searches each subject before admin handoff", async () => {
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
  // The subject's words are resolved to catalog filters, never passed raw.
  const vigoSearch = calls.searches.find((call) => /Vigo/i.test(call.text ?? ""));
  assert.equal(vigoSearch?.fitmentHints?.carBrandName, "Toyota");
  assert.equal(vigoSearch?.fitmentHints?.carModelName, "Hilux Vigo");
  assert.ok(calls.searches.some((call) => /DENSO/i.test(call.text ?? "")));
  assert.ok(calls.searches.some((call) => /น้ำยาแอร์/i.test(call.text ?? "")));
  assert.deepEqual(calls.escalations, ["conversation-1"]);
});

test("Messenger bare price-only turn does not resurrect old product context into search", async () => {
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

async function runMessengerPriceTurn(text: string): Promise<RoutingCalls> {
  const calls = await setupMessengerPriceRoutingTest(text);
  const { processMessengerBatch } = await import("@/lib/messenger/messenger-webhook-processor");
  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-1",
        fbEventId: "event-1",
        text,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );
  return calls;
}

test("golden 2026-10-09 (Messenger): a price-haggle on an All New coil searches the D-Max coil for 2012", async () => {
  // The LINE incident text with a haggle word, which routes Messenger straight to
  // the price rule. "all new" means Isuzu D-Max (owner decision 2026-10-12).
  const calls = await runMessengerPriceTurn("คอยล์เย็น all new ปี 2012 ลดได้ไหมครับ");

  assert.equal(calls.searches.length, 1, JSON.stringify(calls));
  assert.equal(calls.searches[0]?.text, "คอยล์เย็น D-Max 2012");
  assert.equal(calls.searches[0]?.fitmentHints?.carBrandName, "Isuzu");
  assert.equal(calls.searches[0]?.fitmentHints?.carModelName, "D-Max");
  assert.equal(calls.searches[0]?.fitmentHints?.fitmentYear, 2012);
  assert.ok(!calls.searches.some((call) => /ตู้แอร์/.test(call.text ?? "")), "never the universal ตู้แอร์");
  assert.deepEqual(calls.escalations, ["conversation-1"]);
});

test("Messenger price-haggle naming a car the rule cannot read hands off instead of searching", async () => {
  const calls = await runMessengerPriceTurn("คอยเย็น vios 2010 ลดได้ไหม");

  assert.equal(calls.searches.length, 0);
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.textReplies.length, 1);
  assert.match(calls.textReplies[0] ?? "", /สำหรับคอยล์เย็น vios ปี 2010/);
});

test("Messenger price-haggle on a coil with no car hands off with the part named", async () => {
  // A coil only fits a given car; Messenger price turns end with an admin anyway,
  // so it hands off rather than listing every coil in the shop.
  const calls = await runMessengerPriceTurn("คอยเย็น ลดได้ไหมครับ");

  assert.equal(calls.searches.length, 0);
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.match(calls.textReplies[0] ?? "", /สำหรับคอยล์เย็น/);
});
