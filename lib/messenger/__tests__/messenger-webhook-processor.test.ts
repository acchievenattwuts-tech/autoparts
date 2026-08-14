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
  "Messenger preserves no-match handoff and searches every mapped multi-subject category",
  { skip: moduleMocksUnavailable },
  async () => {
  const calls = {
    searches: [] as Array<{ text?: string | null; customerText?: string | null }>,
    textReplies: [] as string[],
    escalations: [] as string[],
    notifications: [] as Array<{ text?: string | null }>,
    aiSuggestions: [] as Array<{ originalText: string }>,
    outboundMessages: [] as string[],
    processedSeqs: [] as number[],
  };

  let inboundSeq = 0;
  const inboundCreatedAt = new Date();
  let currentText = "พัดลมเป่า 14นิ้วมีไหมคับ";
  let currentTexts: string[] | null = null;
  let searchHasResults = false;
  let classifiedGroup: "product" | "purchase" = "product";
  let detectedSubjects: Array<{
    partType: string;
    carBrand: string | null;
    carModel: string | null;
    year: number | null;
    partKind: "fitment";
    query: string;
  }> | null = null;

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
      getUnansweredMessengerMessages: async () =>
        (currentTexts ?? [currentText]).map((text, index) => ({
          id: `inbound-${index + 1}`,
          text,
          messageType: LineMessageType.TEXT,
          imageUrl: null,
          intent: null,
          createdAt: new Date(inboundCreatedAt.getTime() + index),
        })),
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
      buildUnlinkedPriceNote: () => null,
      getChatProductSummaries: async (ids: string[]) =>
        searchHasResults
          ? ids.map((id) => ({
              id,
              name: `สินค้า ${id}`,
              code: id,
              imageUrl: null,
              salePrice: 1000,
              retailPrice: 1000,
              memberPrice: 1000,
            }))
          : [],
      searchChatProductInquiry: async (input: {
        text?: string | null;
        customerText?: string | null;
        fitmentHints?: { categoryName?: string | null } | null;
      }) => {
        calls.searches.push({ text: input.text, customerText: input.customerText });
        const expectedCategory = input.text?.includes("คอมแอร์")
          ? "คอมแอร์ (Compressor)"
          : input.text?.includes("วาล์ว")
          ? "วาล์ว (Expansion Valve)"
          : input.text?.includes("ไดรเออร์")
            ? "ดรายเออร์ (Drier / Receiver Drier)"
            : "ใบพัดลม (Cooling Fan Blade)";
        assert.equal(input.fitmentHints?.categoryName, expectedCategory);
        return {
          searched: true,
          reason: searchHasResults ? "SEARCHED_PRODUCT_INQUIRY" : "SEARCHED_PRODUCT_SPEC_NO_MATCH",
          query: input.text ?? "",
          result: {
            ids: searchHasResults ? [`P-${calls.searches.length}`] : [],
            total: searchHasResults ? 1 : 0,
            mode: "v2",
            matchReasons: searchHasResults ? { [`P-${calls.searches.length}`]: ["name"] } : {},
          },
          needsMoreInfo: !searchHasResults,
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
      extractChatSearchIntent: async (input: { latestText: string }) =>
        input.latestText.includes("ส่งที่อู่")
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
          : input.latestText.includes("508")
          ? {
              group: "product",
              query: "คอมแอร์ 508",
              isProductQuery: true,
              partType: "คอมแอร์",
              carBrand: null,
              carModel: null,
              year: null,
              partKind: "universal",
              tooBroad: false,
            }
          : classifiedGroup === "purchase"
          ? {
              group: "purchase",
              query: "",
              isProductQuery: false,
              partType: null,
              carBrand: null,
              carModel: null,
              year: null,
              partKind: null,
              tooBroad: false,
            }
          : {
              group: "product",
              query: "พัดลมเป่า 14 นิ้ว",
              isProductQuery: true,
              partType: "พัดลม",
              carBrand: null,
              carModel: null,
              year: null,
              partKind: "fitment",
              tooBroad: false,
            },
      buildJuneTextNoMatchHandoffReply: (known?: { partType?: string | null } | null) =>
        `สำหรับ${known?.partType ?? "รายการที่แจ้ง"} จูนขอให้แอดมินช่วยเช็กสต็อกและตัวที่เข้ากันให้ชัวร์ก่อนนะคะ`,
    },
  });

  await mock.module("@/lib/chat-core/fitment-resolve", {
    namedExports: {
      resolveChatFitmentFilters: async (input: { partType?: string | null; queryText?: string | null }) => ({
        categoryName: input.partType?.includes("คอมแอร์") || input.queryText?.includes("คอมแอร์")
          ? "คอมแอร์ (Compressor)"
          : input.partType?.includes("วาล์ว") || input.queryText?.includes("วาล์ว")
          ? "วาล์ว (Expansion Valve)"
          : input.partType?.includes("ไดรเออร์") || input.queryText?.includes("ไดรเออร์")
            ? "ดรายเออร์ (Drier / Receiver Drier)"
            : "ใบพัดลม (Cooling Fan Blade)",
        carModelName: input.queryText?.toLowerCase().includes("triton") ? "Triton" : undefined,
      }),
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

  await mock.module("@/lib/chat-core/multi-subject-detector", {
    namedExports: {
      detectChatMultiSubjects: async () => ({
        subjects: detectedSubjects,
        source: detectedSubjects ? "category_mapping" : "none",
        handoffReason: null,
        categories: detectedSubjects ? ["วาล์ว (Expansion Valve)", "ดรายเออร์ (Drier / Receiver Drier)"] : [],
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
  assert.equal(
    calls.searches[0]?.customerText,
    "พัดลมเป่า 14 นิ้วมีไหมคับ",
    "golden: Messenger keeps the customer-authored source for shared hard constraints",
  );
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

  calls.searches.length = 0;
  calls.textReplies.length = 0;
  calls.escalations.length = 0;
  calls.notifications.length = 0;
  calls.outboundMessages.length = 0;
  currentTexts = null;
  currentText = "คอมแอร์508";
  searchHasResults = false;
  detectedSubjects = null;

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-code-zero",
        fbEventId: "event-code-zero",
        text: currentText,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.deepEqual(calls.searches, [{ text: "คอมแอร์ 508", customerText: "คอมแอร์ 508" }]);
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.ok(calls.textReplies[0]?.includes("แอดมิน"));

  calls.searches.length = 0;
  calls.textReplies.length = 0;
  calls.escalations.length = 0;
  calls.notifications.length = 0;
  calls.outboundMessages.length = 0;
  currentTexts = null;
  currentText = "วาล์ว/ไดรเออร์ Triton ปี 2013";
  searchHasResults = true;
  detectedSubjects = [
    { partType: "วาล์ว", carBrand: null, carModel: "Triton", year: 2013, partKind: "fitment", query: "วาล์ว Triton 2013" },
    { partType: "ไดรเออร์", carBrand: null, carModel: "Triton", year: 2013, partKind: "fitment", query: "ไดรเออร์ Triton 2013" },
  ];

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-2",
        fbEventId: "event-2",
        text: currentText,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.deepEqual(calls.searches.map((search) => search.text), ["วาล์ว Triton 2013", "ไดรเออร์ Triton 2013"]);
  assert.deepEqual(calls.escalations, []);
  assert.deepEqual(calls.notifications, []);

  calls.searches.length = 0;
  calls.textReplies.length = 0;
  calls.escalations.length = 0;
  calls.notifications.length = 0;
  calls.outboundMessages.length = 0;
  currentTexts = ["พัดลมเป่า 14นิ้วมีไหมคับ", "ส่งที่อู่ช่างเตี้ย"];
  currentText = currentTexts.join("\n");
  detectedSubjects = null;
  classifiedGroup = "product";

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-mixed",
        fbEventId: "event-mixed",
        text: currentText,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.equal(calls.searches.length, 1, "mixed burst searches its product segment once");
  assert.doesNotMatch(calls.searches[0]?.text ?? "", /ส่งที่อู่/);
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.doesNotMatch(calls.textReplies[0] ?? "", /แอดมิน/, "product reply is sent before handoff text");
  assert.match(calls.textReplies.at(-1) ?? "", /เรื่องค่าจัดส่งหรือการจัดส่ง.*แอดมิน/);

  calls.searches.length = 0;
  calls.textReplies.length = 0;
  calls.escalations.length = 0;
  calls.notifications.length = 0;
  calls.outboundMessages.length = 0;
  currentTexts = null;
  currentText = "ทำใบเสนอราคามาให้หน่อยได้ไหมคะ ต้องการ 15 อัน";
  detectedSubjects = null;

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-3",
        fbEventId: "event-3",
        text: currentText,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.deepEqual(calls.searches, [], "explicit quotation request never searches products");
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.textReplies[0] ?? "", /ส่งคำขอใบเสนอราคาให้แอดมิน/);

  calls.searches.length = 0;
  calls.textReplies.length = 0;
  calls.escalations.length = 0;
  calls.notifications.length = 0;
  calls.outboundMessages.length = 0;
  currentText = "ค่าสงเท่าไหร สงตจวมั้ย";

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-shipping",
        fbEventId: "event-shipping",
        text: currentText,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.deepEqual(calls.searches, [], "shipping questions never search products");
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.textReplies[0] ?? "", /เรื่องค่าจัดส่งหรือการจัดส่ง.*จูน.*แอดมิน.*แชตนี้/);

  calls.searches.length = 0;
  calls.textReplies.length = 0;
  calls.escalations.length = 0;
  calls.notifications.length = 0;
  calls.outboundMessages.length = 0;
  currentText = "ประกันกี่วัน คืนสินค้าได้ไหม";

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-warranty",
        fbEventId: "event-warranty",
        text: currentText,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.deepEqual(calls.searches, [], "warranty questions never search products");
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.textReplies[0] ?? "", /เรื่องประกันหรือการคืนสินค้า.*จูน.*แอดมิน.*แชตนี้/);

  calls.searches.length = 0;
  calls.textReplies.length = 0;
  calls.escalations.length = 0;
  calls.notifications.length = 0;
  calls.outboundMessages.length = 0;
  currentText = "ช่วยดำเนินการรายการนี้ต่อให้ด้วยค่ะ";
  classifiedGroup = "purchase";

  await processMessengerBatch(
    [
      {
        pageId: "page-1",
        psid: "psid-1",
        mid: "mid-4",
        fbEventId: "event-4",
        text: currentText,
        hasAttachment: false,
        attachmentUrls: [],
      },
    ],
    { pageAccessToken: "token" },
  );

  assert.deepEqual(calls.searches, [], "LLM purchase purpose is routed without product search");
  assert.deepEqual(calls.escalations, ["conversation-1"]);
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.textReplies[0] ?? "", /แอดมิน/);
});
