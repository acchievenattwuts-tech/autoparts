import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import {
  LineAiConfidence,
  LineConversationAiStatus,
  LineIntent,
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

// Regression coverage for the Messenger image completeness gate (parity with the
// LINE Option A+B fix, 2026-07-24): a fitment part photo that only identifies the
// part type but no vehicle must ASK for the car — a bare compressor photo must
// never be answered with mismatched compressors — unless the photo carries a code
// that resolves to a real catalog SKU.
//
// The mocks are registered ONCE (mock.module cannot re-mock a module within a run)
// and read from mutable state so each test can vary the image classification.
type ImageTurnOptions = {
  partType: string | null;
  partKind: "fitment" | "universal" | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  searchHints: string[];
  partNumber: string | null;
  catalogCodes: string[];
};

let opts: ImageTurnOptions = {
  partType: null,
  partKind: null,
  confidence: "HIGH",
  searchHints: [],
  partNumber: null,
  catalogCodes: [],
};

const calls = {
  searches: [] as Array<{ text?: string | null }>,
  textReplies: [] as string[],
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
      // Image-only burst: no text (mergedText empty), one attachment.
      getUnansweredMessengerMessages: async () => [
        {
          id: "inbound-img",
          text: null,
          messageType: LineMessageType.IMAGE,
          imageUrl: "https://cdn.example/part.jpg",
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
      resolveCatalogCodes: async (codes: string[]) => codes.filter((code) => opts.catalogCodes.includes(code)),
      searchChatProductInquiry: async (input: { text?: string | null }) => {
        calls.searches.push({ text: input.text });
        return {
          searched: true,
          reason: "SEARCHED_PRODUCT_INQUIRY",
          query: input.text ?? "",
          result: {
            ids: [`id-${calls.searches.length}`],
            total: 1,
            mode: "v2",
            matchReasons: { [`id-${calls.searches.length}`]: ["name"] },
          },
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
      generateChatSuggestion: async () => ({
        suggestedReply: "พบสินค้าใกล้เคียงค่ะ",
        confidence: LineAiConfidence.POSSIBLE_MATCH,
        reasoningSummary: "test",
      }),
      generateScopedConversationalReply: async () => "scoped reply",
      extractChatSearchIntent: async () => null,
    },
  });

  await mock.module("@/lib/car-brand-alias-loader", {
    namedExports: { loadCarBrandVariantLookup: async () => new Map<string, string[]>() },
  });
  await mock.module("@/lib/car-model-alias-loader", {
    namedExports: { loadCarModelVariantLookup: async () => new Map<string, string[]>() },
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
      classifyMessengerImage: async () => ({
        classification: {
          kind: "part_image",
          intent: LineIntent.PART_IMAGE_INQUIRY,
          searchHints: opts.searchHints,
          confidence: opts.confidence,
          reason: "TEST_STUB",
          partType: opts.partType,
          carBrand: null,
          carModel: null,
          year: null,
          partKind: opts.partKind,
          partNumber: opts.partNumber,
          ocr: null,
        },
        content: Buffer.alloc(0),
      }),
      ingestMessengerPaymentSlip: async () => undefined,
    },
  });
});

async function runImageTurn(next: ImageTurnOptions, fbEventId: string) {
  opts = next;
  calls.searches.length = 0;
  calls.textReplies.length = 0;
  const { processMessengerBatch } = await import("@/lib/messenger/messenger-webhook-processor");
  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: fbEventId,
        fbEventId,
        text: null,
        hasAttachment: true,
        attachmentUrls: ["https://cdn.example/part.jpg"],
      },
    ],
    { pageAccessToken: "token" },
  );
}

test(
  "Messenger image gate: a fitment part photo with no vehicle + no catalog SKU asks for the car (does NOT search)",
  { skip: moduleMocksUnavailable },
  async () => {
    // Production regression (mirrors LINE conv cmryljcnx): partType=คอมแอร์ (fitment),
    // no car, OCR yielded only category words + a non-catalog stamped number ("072060").
    await runImageTurn(
      {
        partType: "คอมแอร์",
        partKind: "fitment",
        confidence: "HIGH",
        searchHints: ["คอมแอร์", "072060"],
        partNumber: null,
        catalogCodes: [],
      },
      "event-img-1",
    );

    assert.equal(calls.searches.length, 0, "no validated code + no car → must not search");
    assert.match(calls.textReplies[0] ?? "", /รุ่นรถ/, "asks the customer for the vehicle");
  },
);

test(
  "Messenger image gate: a photo carrying a validated catalog SKU searches without asking the car",
  { skip: moduleMocksUnavailable },
  async () => {
    await runImageTurn(
      {
        partType: "คอมแอร์",
        partKind: "fitment",
        confidence: "HIGH",
        searchHints: ["คอมแอร์", "STA-7018"],
        partNumber: null,
        catalogCodes: ["sta-7018"],
      },
      "event-img-2",
    );

    assert.equal(calls.searches.length, 1, "a validated SKU on the photo searches without asking the car");
  },
);
