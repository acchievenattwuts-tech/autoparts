import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { LineAiConfidence, LineConversationAiStatus, LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { CHAT_IMAGE_READ_TIMEOUT_HANDOFF_REPLY } from "@/lib/chat-core/search-gate";

// The import graph reaches lib/db.ts, which throws without a connection string.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

// `mock.module` only exists when node runs with --experimental-test-module-mocks
// (npm test passes it). Skip instead of crashing under a plain `tsx --test`.
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks — run via `npm test`";

// Parity with the LINE image-read deadline (2026-11-04 incident): a Messenger
// image that is not read before the deadline hands the turn to an admin, and a
// read that finishes afterwards still stores a payment slip.
type ImageMode = "hang" | "late_slip";
let imageMode: ImageMode = "hang";

const calls = {
  searches: 0,
  textReplies: [] as string[],
  adminHandoffs: 0,
  adminNotifications: 0,
  slipIngests: 0,
  slipNotifications: 0,
  timeoutAudits: 0,
};
let inboundSeq = 0;

function resetCalls(): void {
  calls.searches = 0;
  calls.textReplies.length = 0;
  calls.adminHandoffs = 0;
  calls.adminNotifications = 0;
  calls.slipIngests = 0;
  calls.slipNotifications = 0;
  calls.timeoutAudits = 0;
}

const SLIP_RESULT = {
  classification: {
    kind: "payment_slip",
    intent: LineIntent.PAYMENT_SLIP_IMAGE,
    searchHints: [],
    confidence: "HIGH",
    reason: "TEST_STUB",
    ocr: { amount: 1250, transferDatetimeIso: null, bank: null, senderName: null, receiverName: null, referenceNo: "R1", rawText: null },
  },
  content: { mimeType: "image/jpeg", dataBase64: "AAAA" },
};

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
        calls.adminHandoffs += 1;
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
          id: "inbound-img",
          text: null,
          messageType: LineMessageType.IMAGE,
          imageUrl: "https://cdn.example/photo.jpg",
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
      buildUnlinkedPriceNote: () => "",
      CHAT_PRODUCT_DISPLAY_LIMIT: 5,
      CHAT_PRODUCT_FETCH_LIMIT: 10,
      getChatProductSummaries: async () => [],
      resolveCatalogCodes: async () => [],
      searchChatProductInquiry: async () => {
        calls.searches += 1;
        return { searched: false, reason: "NON_SEARCHABLE", query: null, result: null };
      },
    },
  });

  await mock.module("@/lib/chat-core/ai-service", {
    namedExports: {
      generateChatSuggestion: async () => ({
        suggestedReply: "x",
        confidence: LineAiConfidence.POSSIBLE_MATCH,
        reasoningSummary: "test",
      }),
      extractChatSearchIntent: async () => null,
    },
  });

  await mock.module("@/lib/car-brand-alias-loader", {
    namedExports: { loadCarBrandVariantLookup: async () => new Map<string, string[]>() },
  });
  await mock.module("@/lib/car-model-alias-loader", {
    namedExports: {
      loadCarModelVariantLookup: async () => new Map<string, string[]>(),
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
      notifyMessengerNeedsAdmin: async () => {
        calls.adminNotifications += 1;
      },
      notifyMessengerNewConversation: async () => undefined,
      notifyMessengerPaymentSlip: async () => {
        calls.slipNotifications += 1;
      },
    },
  });

  await mock.module("@/lib/chat-core/ai-failure-telemetry", {
    namedExports: {
      logMessengerChatAiFailure: async () => undefined,
      logMessengerImageReadTimeoutHandoff: async () => {
        calls.timeoutAudits += 1;
      },
    },
  });

  await mock.module("@/lib/messenger/messenger-image-service", {
    namedExports: {
      classifyMessengerImage: () =>
        imageMode === "hang"
          ? new Promise<never>(() => undefined)
          : new Promise((resolve) => setTimeout(() => resolve(SLIP_RESULT), 150)),
      ingestMessengerPaymentSlip: async () => {
        calls.slipIngests += 1;
        return { slipId: "slip-1", verificationStatus: "PENDING_REVIEW", ocr: SLIP_RESULT.classification.ocr, imageStored: true };
      },
    },
  });
});

async function runImageTurn(mode: ImageMode, receivedAgoMs: number, fbEventId: string): Promise<void> {
  imageMode = mode;
  resetCalls();
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
        attachmentUrls: ["https://cdn.example/photo.jpg"],
      },
    ],
    { pageAccessToken: "token", receivedAt: new Date(Date.now() - receivedAgoMs) },
  );
}

test(
  "Messenger image-read deadline: a hung vision call hands the turn to an admin without searching",
  { skip: moduleMocksUnavailable },
  async () => {
    // 55s in: past the 38s cutoff and the 50s late-read grace, so the hung call
    // is never awaited.
    await runImageTurn("hang", 55_000, "event-img-hang");

    assert.deepEqual(calls.textReplies, [CHAT_IMAGE_READ_TIMEOUT_HANDOFF_REPLY]);
    assert.equal(calls.searches, 0, "no search on an unread image");
    assert.equal(calls.adminHandoffs, 1, "conversation escalated to an admin");
    assert.equal(calls.adminNotifications, 1, "admins alerted");
    assert.equal(calls.timeoutAudits, 1, "audit row written");
    assert.equal(calls.slipIngests, 0);
  },
);

test(
  "Messenger image-read deadline: a read that finishes after the hand-off still stores the payment slip",
  { skip: moduleMocksUnavailable },
  async () => {
    // The owner debounces ~3s before reading, so with receivedAt 37.95s ago the
    // read starts past the 38s cutoff (immediate hand-off) and the slip arrives
    // ~150ms later, inside the 50s grace.
    await runImageTurn("late_slip", 37_950, "event-img-late-slip");

    assert.deepEqual(calls.textReplies, [CHAT_IMAGE_READ_TIMEOUT_HANDOFF_REPLY], "one reply only, no slip ack");
    assert.equal(calls.slipIngests, 1, "the late slip is stored");
    assert.equal(calls.slipNotifications, 1, "and announced");
  },
);
