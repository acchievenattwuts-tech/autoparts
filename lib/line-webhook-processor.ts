import {
  LineAiConfidence,
  LineAiSuggestionStatus,
  LineAiJobStatus,
  LineAiJobType,
  LineConversationAiStatus,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineIntent,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
import { classifyLineImage, type LineImageClassification } from "@/lib/line-image-service";
import { LINE_AI_SETTINGS_DEFAULTS } from "@/lib/line-ai-settings";
import { ingestPaymentSlip } from "@/lib/line-payment-slip-ingest";
import {
  buildJuneAskDetailsReply,
  buildJuneDeadlineReply,
  buildJuneOutOfScopeReply,
  buildJunePartImageNoMatchReply,
  buildJuneTextNoMatchHandoffReply,
  buildJuneSmalltalkReply,
  buildJuneSocialReply,
  extractChatSearchIntent,
  generateChatSuggestion,
  generateScopedConversationalReply,
  type ChatReplyHistoryItem,
  type ChatSearchIntent,
} from "@/lib/chat-core/ai-service";
import { resolveKnownQueryIntent } from "@/lib/chat-core/known-query-intent";
import {
  isAccessoryOrChemicalIntent,
  resolveChatFitmentFilters,
  type ChatFitmentFilters,
} from "@/lib/chat-core/fitment-resolve";
import { correctPartSpelling } from "@/lib/chat-core/category-llm-fallback";
import { stageAiCategoryAlias } from "@/lib/chat-core/category-alias-staging";
import { normalizeInboundChatQuery } from "@/lib/chat-core/text-normalize";
import { loadCarBrandVariantLookup } from "@/lib/car-brand-alias-loader";
import { loadCarModelVariantLookup } from "@/lib/car-model-alias-loader";
import { groupToRoute, intentToGroup, type ChatMessageGroup } from "@/lib/chat-core/intent-groups";
import { resolveLineAiSendDecision } from "@/lib/line-ai-policy";
import {
  acquireLineConversationLock,
  appendLineMessage,
  bumpLineInboundSeq,
  DuplicateLineEventError,
  countConsecutiveFailedLineSearches,
  countPendingPaymentSlipsForConversation,
  findActiveCustomerIdByLineUserId,
  resolveLinePriceTier,
  findStalledCoalescedConversationIds,
  getLineCoalesceState,
  getLineConversationForRecovery,
  getLineInquiryFrame,
  getOrCreateLineConversation,
  getRecentLineMessagesForAi,
  getUnansweredInboundLineMessages,
  getStoredImageClassificationsByMessageRowIds,
  updateLineInquiryFrame,
  hasProcessedLineEvent,
  markLineProcessedSeq,
  markOutboundLineMessageSent,
  releaseLineConversationLock,
  renewLineConversationLock,
  storeLineAiJob,
  storeLineAiAudit,
  storeLineAiSuggestion,
  updateLineAiJob,
  updateLineConversationState,
} from "@/lib/line-conversation-repository";
import { buildLineConversationStatePatch } from "@/lib/line-conversation-service";
import { routeChatIntent } from "@/lib/chat-core/intent-router";
import { pushLineMessages, replyLineMessage, startLineLoadingAnimation } from "@/lib/line-messaging";
import {
  applyChatPriceTier,
  getChatProductSummaries,
  resolveCatalogCodes,
  searchChatProductInquiry,
} from "@/lib/chat-core/product-search-bridge";
import { buildProductFlexMessage, resolveFlexPlaceholderImageUrl } from "@/lib/line-flex-product-card";
import { classifyPurchaseIntent } from "@/lib/line-purchase-intent";
import { extractFitmentTerms } from "@/lib/chat-core/fitment-extract";
import { answerFromChatFaq } from "@/lib/chat-core/faq";
import { normalizeLineWebhookEvents } from "@/lib/line-webhook-events";
import { notifyLineOaNeedsAdmin } from "@/lib/notifications";
import { mirrorLineMessageToTelegram } from "@/lib/telegram";
import type { LinePushMessage } from "@/lib/line-daily-summary";
import {
  buildPriceProductSearchIntent,
  extractPriceProductSubjectsFromText,
} from "@/lib/chat-core/price-product-subjects";
import {
  extractChatRequiredSearchTokens,
  guardChatSearchIntent,
  lineValueHasCustomerEvidence,
  lineValueHasCustomerTypoEvidence,
} from "@/lib/chat-core/search-guards";
import { isDirectProductCodeToken } from "@/lib/product-search-required-tokens";
import { parseCarYearRangeStart } from "@/lib/car-year-shorthand";
import {
  BROAD_FALLBACK_NEAR_MATCH_NOTE,
  buildChatSearchAskReply,
  buildChatSearchFollowUp,
  buildDidYouMeanNote,
  CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY,
  CHAT_VEHICLE_UNRESOLVED_HANDOFF_REPLY,
  CHAT_WEAK_MATCH_HANDOFF_REPLY,
  decideChatSearchGate,
  isBroadChatPartType,
} from "@/lib/chat-core/search-gate";
import {
  boundMessagesToSession,
  buildFrameQuery,
  hasFollowUpConnective,
  isFrameStale,
  namesVehicleClassTerm,
  reconcileInquiryFrame,
  type InquiryFrame,
} from "@/lib/chat-core/inquiry-frame";

export type LineWebhookProcessorConfig = {
  channelAccessToken: string | null;
  autoReplyEnabled?: boolean;
  dryRun?: boolean;
  /** When true, part-image vision hints are fed into product search (default off). */
  imageSearchEnabled?: boolean;
  lineProfilesByUserId?: Record<string, { displayName?: string | null; pictureUrl?: string | null }>;
  allowPushFallback?: boolean;
  receivedAt?: Date;
  replyTokenMaxAgeMs?: number;
  /** When true, inbound messages are aggregated per conversation (debounce +
   *  abort-on-newer) so a burst of images/texts yields ONE reply. When false /
   *  omitted, the legacy per-event path runs (one reply per event). */
  coalesce?: boolean;
  /** Quiet window (ms) the owner waits for the customer to stop sending before it
   *  processes the coalesced turn. Default 3000. */
  coalesceWindowMs?: number;
  /** Processing-lock lease (ms); auto-reclaimed if the owner crashes. Default 60000. */
  coalesceLeaseMs?: number;
};

export type LineWebhookProcessResult = {
  processedCount: number;
  duplicateCount: number;
  skippedCount: number;
  repliedCount: number;
};

export type LineWebhookProcessorDependencies = {
  hasProcessedLineEvent: typeof hasProcessedLineEvent;
  findActiveCustomerIdByLineUserId: typeof findActiveCustomerIdByLineUserId;
  /** Optional override; resolves whether the LINE user may see real prices. */
  resolveLinePriceTier?: typeof resolveLinePriceTier;
  getOrCreateLineConversation: typeof getOrCreateLineConversation;
  appendLineMessage: typeof appendLineMessage;
  updateLineConversationState: typeof updateLineConversationState;
  storeLineAiAudit: typeof storeLineAiAudit;
  storeLineAiSuggestion: typeof storeLineAiSuggestion;
  markOutboundLineMessageSent: typeof markOutboundLineMessageSent;
  storeLineAiJob: typeof storeLineAiJob;
  updateLineAiJob: typeof updateLineAiJob;
  searchChatProductInquiry: typeof searchChatProductInquiry;
  /** Optional override; validates code-like tokens against the catalog for the
   *  product-code fast-path (customer-typed code / image-OCR'd part number). */
  resolveCatalogCodes?: typeof resolveCatalogCodes;
  getChatProductSummaries: typeof getChatProductSummaries;
  replyLineMessage: typeof replyLineMessage;
  pushLineMessages: typeof pushLineMessages;
  /** Optional override; shows the LINE typing dots while the bot prepares a reply
   *  (best-effort; only fired when the bot will actually auto-reply). */
  startLineLoadingAnimation?: typeof startLineLoadingAnimation;
  /** Optional override; defaults to the Gemini-backed generator with rule-based fallback. */
  generateChatSuggestion?: typeof generateChatSuggestion;
  /** Optional override; defaults to the Gemini-vision classifier with safe fallback. */
  classifyLineImage?: typeof classifyLineImage;
  /** Optional override; defaults to the full slip ingest (fetch → OCR → store). */
  ingestPaymentSlip?: typeof ingestPaymentSlip;
  /** Optional override; defaults to the admin bell + Telegram dispatch via
   *  `createNotification()` (Iron Rule §8 — bell and Telegram are paired). */
  notifyLineOaNeedsAdmin?: typeof notifyLineOaNeedsAdmin;
  /** Optional override; defaults to fetching recent messages for AI short-term memory. */
  getRecentLineMessagesForAi?: typeof getRecentLineMessagesForAi;
  /** Optional override; counts consecutive empty searches for the escalate-to-admin rule. */
  countConsecutiveFailedLineSearches?: typeof countConsecutiveFailedLineSearches;
  /** Optional override; counts payment slips on the conversation that still need
   *  admin attention, so the handoff notification title can hint about it. */
  countPendingPaymentSlipsForConversation?: typeof countPendingPaymentSlipsForConversation;
  /** Optional override; AI fallback classifier for purchase intent. */
  classifyPurchaseIntent?: typeof classifyPurchaseIntent;
  /** Optional override; answers UNKNOWN questions grounded in the shop FAQ. */
  answerFromChatFaq?: typeof answerFromChatFaq;
  /** Optional override; extracts the running search subject + structured fitment
   *  hints from conversation history (search-side memory for drip-fed details). */
  extractChatSearchIntent?: typeof extractChatSearchIntent;
  /** Optional override; resolves AI fitment hints to canonical master-data names
   *  for use as precise hard filters in product search. */
  resolveChatFitmentFilters?: typeof resolveChatFitmentFilters;
  /** Optional override; LLM spell-correction fallback used only when the
   *  deterministic resolver cannot map a category. Injected so tests can stub it. */
  correctPartSpelling?: typeof correctPartSpelling;
  /** Optional override; loads the DB-backed Thai↔English brand spelling lookup
   *  (cached) so the search guard can ground a Thai-typed brand. */
  loadCarBrandVariantLookup?: typeof loadCarBrandVariantLookup;
  /** Optional override; loads the DB-backed Thai↔English model spelling lookup
   *  (SearchSynonym, cached) so the guard can ground a Thai-typed model
   *  ("สตาด้า"→"Strada"). */
  loadCarModelVariantLookup?: typeof loadCarModelVariantLookup;
  /** Optional override; AI-generates a scoped จูน-voiced reply for the
   *  `smalltalk` / `out_of_scope` groups (writes its own wording but stays in
   *  scope and steers back to parts). */
  generateScopedConversationalReply?: typeof generateScopedConversationalReply;
  // ── Coalescing engine deps (only used when config.coalesce === true) ──────
  acquireLineConversationLock?: typeof acquireLineConversationLock;
  releaseLineConversationLock?: typeof releaseLineConversationLock;
  renewLineConversationLock?: typeof renewLineConversationLock;
  bumpLineInboundSeq?: typeof bumpLineInboundSeq;
  getLineCoalesceState?: typeof getLineCoalesceState;
  markLineProcessedSeq?: typeof markLineProcessedSeq;
  getUnansweredInboundLineMessages?: typeof getUnansweredInboundLineMessages;
  /** Reuses ingest-time vision classifications on owner re-runs / cron recovery
   *  so an image is never re-OCR'd (B2a). Keyed by inbound LineMessage row id. */
  getStoredImageClassificationsByMessageRowIds?: typeof getStoredImageClassificationsByMessageRowIds;
  findStalledCoalescedConversationIds?: typeof findStalledCoalescedConversationIds;
  getLineConversationForRecovery?: typeof getLineConversationForRecovery;
  /** Inquiry-frame (conversation slot memory) read/write. */
  getLineInquiryFrame?: typeof getLineInquiryFrame;
  updateLineInquiryFrame?: typeof updateLineInquiryFrame;
  /** Injectable debounce sleep (default real setTimeout; tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
};

const defaultDependencies: LineWebhookProcessorDependencies = {
  hasProcessedLineEvent,
  findActiveCustomerIdByLineUserId,
  resolveLinePriceTier,
  getOrCreateLineConversation,
  appendLineMessage,
  updateLineConversationState,
  storeLineAiAudit,
  storeLineAiSuggestion,
  markOutboundLineMessageSent,
  storeLineAiJob,
  updateLineAiJob,
  searchChatProductInquiry,
  resolveCatalogCodes,
  getChatProductSummaries,
  replyLineMessage,
  pushLineMessages,
  startLineLoadingAnimation,
  generateChatSuggestion,
  classifyLineImage,
  ingestPaymentSlip,
  notifyLineOaNeedsAdmin,
  getRecentLineMessagesForAi,
  countConsecutiveFailedLineSearches,
  countPendingPaymentSlipsForConversation,
  classifyPurchaseIntent,
  answerFromChatFaq,
  extractChatSearchIntent,
  resolveChatFitmentFilters,
  loadCarBrandVariantLookup,
  loadCarModelVariantLookup,
  generateScopedConversationalReply,
  acquireLineConversationLock,
  releaseLineConversationLock,
  renewLineConversationLock,
  bumpLineInboundSeq,
  getLineCoalesceState,
  markLineProcessedSeq,
  getUnansweredInboundLineMessages,
  getStoredImageClassificationsByMessageRowIds,
  findStalledCoalescedConversationIds,
  getLineConversationForRecovery,
  getLineInquiryFrame,
  updateLineInquiryFrame,
};

const MAX_FAILED_SEARCHES_BEFORE_HANDOFF = 2;
// Safety margin before the reply-token window closes: send the (deterministic)
// reply this many ms early so it still goes out on the FREE reply token.
const REPLY_DEADLINE_MARGIN_MS = 5_000;
const WEBHOOK_MAX_DURATION_MS = 60_000;
const POST_SEARCH_DELIVERY_FALLBACK_MIN_BUDGET_MS = 12_000;
const NO_RESULTS_ESCALATION_MESSAGE =
  "จูนขอส่งเรื่องให้แอดมินช่วยเช็กตัวที่ตรงให้ชัวร์ก่อนนะคะ 🙏 เดี๋ยวติดต่อกลับโดยเร็วที่สุดค่ะ ระหว่างนี้ถ้ามีปีรถ รุ่นย่อย หรือรูปอะไหล่เดิม ส่งเพิ่มมาได้เลยค่ะ 😊";
const PURCHASE_HANDOFF_MESSAGE =
  "รับทราบค่ะ 😊 เดี๋ยวแอดมินมาช่วยสรุปราคาและการจัดส่งให้นะคะ รอสักครู่นะคะ 🙏";
// Sent as a bubble AFTER the matched products on a price inquiry — the customer
// sees the options, and the exact price/promo is confirmed by a human.
const SERVICE_HANDOFF_MESSAGE =
  "\u0e08\u0e39\u0e19\u0e02\u0e2d\u0e2a\u0e48\u0e07\u0e40\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e07\u0e32\u0e19\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23\u0e43\u0e2b\u0e49\u0e41\u0e2d\u0e14\u0e21\u0e34\u0e19\u0e0a\u0e48\u0e27\u0e22\u0e40\u0e0a\u0e47\u0e01\u0e43\u0e2b\u0e49\u0e19\u0e30\u0e04\u0e30 \u0e23\u0e2d\u0e41\u0e2d\u0e14\u0e21\u0e34\u0e19\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e01\u0e25\u0e31\u0e1a\u0e2a\u0e31\u0e01\u0e04\u0e23\u0e39\u0e48\u0e04\u0e48\u0e30 \uD83D\uDE0A";
const PRICE_INQUIRY_DEFER_NOTE =
  "ส่วนเรื่องราคา/โปรโมชั่น เดี๋ยวจูนให้แอดมินมาช่วยสรุปให้นะคะ 🙏";
// ลูกค้าที่ซ่อนราคา (ประเภททั่วไป/ยังไม่ผูกบัญชี) ถามราคา → ต้องส่งเรื่องให้แอดมินแจ้งราคาเอง
// (สอดคล้องกับการซ่อนราคาหน้าเว็บ/แชท). กรณีเดียว (ไม่มีการ์ด) ใช้เป็นข้อความหลัก, กรณีมีการ์ดใช้เป็น note ต่อท้าย
const PRICE_HIDDEN_HANDOFF_MESSAGE =
  "จูนขอส่งเรื่องให้แอดมินช่วยแจ้งราคาให้นะคะ 🙏 รอแอดมินติดต่อกลับสักครู่ค่ะ 😊";
// ต่อท้ายการ์ด/รายการเมื่อเป็นสินค้าใหม่ที่เพิ่งถาม (topicShift) — โชว์ของก่อนแล้วส่งเรื่องราคาให้แอดมิน
const PRICE_HIDDEN_HANDOFF_NOTE =
  "ส่วนเรื่องราคา จูนขอส่งเรื่องให้แอดมินช่วยแจ้งให้นะคะ 🙏 รอแอดมินติดต่อกลับสักครู่ค่ะ";
// คำถาม/ต่อรองเชิงราคา (เสริมจาก regex intent เดิม) — ทุกกรณีส่งเรื่องให้แอดมินแจ้ง/ยืนยันราคา
// "ราคา" (substring) ครอบคลุม ขอราคา/เช็กราคา/ราคาอู่/ราคาช่าง/ราคาส่ง/ราคาลด/ราคาพิเศษ/ราคาเพื่อน ฯลฯ
// ที่เหลือจับคำถามราคา-ส่วนลดที่ไม่มีคำว่า "ราคา" ในประโยค
const PRICE_QUESTION_RE =
  /(ราคา|กี่บาท|กี่ตัง|เท่าไหร่|เท่าไร|เท่าไหร|ส่วนลด|ลดราคา|ลดได้|ลดหน่อย|ลดให้|ลดไหม|ลดมั้ย|มีลด|มีโปร|โปรโมชั่น|โปรโมชัน)/;
const SHOP_INFO_MESSAGE = `🔧 ยินดีให้บริการค่ะ

ถ้าต้องการให้จูนช่วยค้นหาอะไหล่แอร์หรือหม้อน้ำรถยนต์ รบกวนแจ้ง 3 อย่างนี้
เดี๋ยวจูนค้นให้ทันทีเลยค่ะ 👇
1️⃣ ยี่ห้อ / รุ่นรถ (เช่น Toyota Vios 2020)
2️⃣ อะไหล่ที่ต้องการ (เช่น คอมเพรสเซอร์, แผงร้อน, ตู้แอร์, หม้อน้ำ)
3️⃣ รูปอะไหล่เก่า (ถ้ามี จะช่วยให้ระบุรุ่นแม่นขึ้น)

🚚 มีบริการจัดส่งทั่วประเทศ — ค่าขนส่งคิดตามขนาด/น้ำหนักสินค้า ภายใน จ.นครสวรรค์คิดตามระยะทางค่ะ

💻 ใช้งานผ่าน LINE PC: พิมพ์คำว่า “เมนู” เพื่อเปิดบริการ

📞 โทรสอบถาม: 065-751-7873
📍 แผนที่ร้าน: https://maps.app.goo.gl/VeXeuTUA9CjTuxhEA
🕐 เปิดทุกวัน จันทร์ - อาทิตย์ เวลา 08:30 - 18:00 น. ค่ะ 🙏`;

// "เมนู" / "menu" opens LINE's rich menu (handled by LINE itself). The AI must
// stay silent and active — no reply, no handoff — and wait for the next message.
const MENU_COMMAND_RE = /^(เมนู|menu)$/i;
function isMenuCommand(text: string | null | undefined): boolean {
  return Boolean(text && MENU_COMMAND_RE.test(text.trim()));
}

// A "meaningful" character = a Latin letter, a digit, or a Thai consonant/vowel.
// Thai symbols ๆ (U+0E46) / ฯ (U+0E2F) and tone marks are intentionally excluded.
const MEANINGFUL_CHAR_RE = /[a-zA-Z0-9ก-ฮะ-ไ]/;
// True for a no-content message like "...", "??", "ๆๆ", or emoji-only. These must
// NOT enter the search pipeline: the intent classifier would otherwise resurrect
// the previous subject from chat history and re-answer a question the customer
// never re-asked. Handled like a sticker — silent, AI stays active.
function isNoiseText(text: string | null | undefined): boolean {
  const trimmed = text?.trim();
  if (!trimmed) return false; // empty / image turns are handled elsewhere
  return !MEANINGFUL_CHAR_RE.test(trimmed);
}

// A sticker is almost always a conversation-closer ("thanks / ok 🙏" after a slip
// or a wrapped-up chat), not a question. Routing it through the normal pipeline
// makes it land on UNKNOWN → admin hand-off, which (a) replies with the generic
// "รับทราบค่ะ เดี๋ยวแอดมินมาดูแล" filler — repeated every sticker — and (b) freezes
// the AI + pings admins for nothing. Policy: greet ONCE on a fresh / long-idle
// contact (so a sticker that opens a brand-new chat still gets a hello), otherwise
// stay completely silent. Never hand off, never notify on a sticker.
const STICKER_GREETING_REWAKE_MS = 6 * 60 * 60 * 1000; // 6h since the last customer turn
const STICKER_GREETING_MESSAGE =
  "สวัสดีค่ะ 🙏 จูนยินดีช่วยดูแลค่ะ ต้องการอะไหล่แอร์หรือหม้อน้ำรถยนต์ รบกวนแจ้งยี่ห้อ/รุ่นรถ ปีรถ และอะไหล่ที่ต้องการได้เลยนะคะ เดี๋ยวจูนช่วยหาให้ค่ะ 😊";

async function handleStickerEvent(
  input: ProcessLineAiReplyInput,
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
): Promise<{ replied: boolean }> {
  const autoReplyEnabled = config.autoReplyEnabled ?? LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled;
  const dryRun = config.dryRun ?? LINE_AI_SETTINGS_DEFAULTS.dryRun;
  const liveMode = autoReplyEnabled && !dryRun;

  const prevCustomerAt = input.conversation.lastCustomerMessageAt;
  const isFreshContact =
    !prevCustomerAt || Date.now() - prevCustomerAt.getTime() > STICKER_GREETING_REWAKE_MS;
  const hasReplyToken = canUseReplyToken(config, input.canReply);

  // Greet only when the AI is allowed to send, the conversation is still AI-owned
  // (not paused/handed off/closed), it's a fresh contact, and we can actually reply.
  const shouldGreet =
    liveMode &&
    isFreshContact &&
    input.conversation.aiStatus === LineConversationAiStatus.ACTIVE &&
    hasReplyToken &&
    Boolean(input.replyToken) &&
    Boolean(config.channelAccessToken);

  let replied = false;
  if (shouldGreet && input.replyToken && config.channelAccessToken) {
    const outboundMessage = await dependencies.appendLineMessage({
      conversationId: input.conversation.id,
      lineUserId: input.lineUserId,
      direction: LineMessageDirection.OUTBOUND_AI,
      messageType: input.messageType,
      intent: LineIntent.GREETING,
      text: STICKER_GREETING_MESSAGE,
      deliveryMode: LineDeliveryMode.REPLY,
      deliveryStatus: LineDeliveryStatus.PENDING,
    });
    await dependencies.replyLineMessage({
      channelAccessToken: config.channelAccessToken,
      replyToken: input.replyToken,
      messages: [textMessage(STICKER_GREETING_MESSAGE)],
    });
    await dependencies.markOutboundLineMessageSent({
      messageId: outboundMessage.id,
      deliveryMode: LineDeliveryMode.REPLY,
    });
    replied = true;
  }

  fireAndForgetAudit(dependencies, {
    conversationId: input.conversation.id,
    action: "STICKER_HANDLED",
    payload: {
      lineEventId: input.lineEventId,
      greeted: replied,
      isFreshContact,
      reason: replied ? "GREETED_FRESH_CONTACT" : "SILENT",
    },
  });

  // No admin hand-off, no notification, no state change — the AI stays active and
  // simply waits for the next (real) message.
  await dependencies.updateLineAiJob(input.jobId, {
    status: LineAiJobStatus.COMPLETED,
    result: { action: replied ? "sticker_greeted" : "sticker_ignored", replied },
    finishedAt: new Date(),
  });

  return { replied };
}

/**
 * Handles a `social` message (ขอบคุณ / โอเค / คุยเล่นสั้น ๆ): a short warm ack — or
 * stays silent when it's just a closing ack right after the shop replied (the last
 * history turn is from the shop), to avoid back-and-forth ping-pong. Never searches,
 * never hands off, never notifies. Respects admin take-over (only replies when the
 * conversation is still AI-active).
 */
async function handleSocialTurn(
  input: ProcessLineAiReplyInput,
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
  history: ChatReplyHistoryItem[],
): Promise<{ replied: boolean }> {
  const autoReplyEnabled = config.autoReplyEnabled ?? LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled;
  const dryRun = config.dryRun ?? LINE_AI_SETTINGS_DEFAULTS.dryRun;
  const liveMode = autoReplyEnabled && !dryRun;

  // Closing ack right after the shop's own reply → stay silent.
  const isClosingAck = history[history.length - 1]?.role === "shop";
  const hasReplyToken = canUseReplyToken(config, input.canReply);

  const shouldReply =
    liveMode &&
    input.conversation.aiStatus === LineConversationAiStatus.ACTIVE &&
    !isClosingAck &&
    hasReplyToken &&
    Boolean(input.replyToken) &&
    Boolean(config.channelAccessToken);

  let replied = false;
  if (shouldReply && input.replyToken && config.channelAccessToken) {
    const outboundMessage = await dependencies.appendLineMessage({
      conversationId: input.conversation.id,
      lineUserId: input.lineUserId,
      direction: LineMessageDirection.OUTBOUND_AI,
      messageType: input.messageType,
      intent: LineIntent.GREETING,
      text: buildJuneSocialReply(),
      deliveryMode: LineDeliveryMode.REPLY,
      deliveryStatus: LineDeliveryStatus.PENDING,
    });
    await dependencies.replyLineMessage({
      channelAccessToken: config.channelAccessToken,
      replyToken: input.replyToken,
      messages: [textMessage(buildJuneSocialReply())],
    });
    await dependencies.markOutboundLineMessageSent({
      messageId: outboundMessage.id,
      deliveryMode: LineDeliveryMode.REPLY,
    });
    replied = true;
  }

  fireAndForgetAudit(dependencies, {
    conversationId: input.conversation.id,
    action: "SOCIAL_HANDLED",
    payload: { lineEventId: input.lineEventId, replied, isClosingAck },
  });

  await dependencies.updateLineAiJob(input.jobId, {
    status: LineAiJobStatus.COMPLETED,
    result: { action: replied ? "social_reply" : "social_silent", replied },
    finishedAt: new Date(),
  });

  return { replied };
}

/**
 * Handles the `smalltalk` / `out_of_scope` groups: the AI writes its own
 * จูน-voiced reply (bounded by the per-group scope directive + global safety
 * rules, always steering back to parts) instead of a fixed template. Mirrors
 * `handleSocialTurn`'s delivery/policy plumbing, but:
 *  - delivers on the reply token, or PUSH when the token's gone and fallback is on;
 *  - is budget-aware — if the reply-token window is nearly closed (or AI is off /
 *    not deliverable), it skips the Gemini call and uses the deterministic
 *    template so the message still goes out on the free reply token;
 *  - never hands off to an admin (these groups are auto-answerable).
 */
async function handleScopedConversationalTurn(
  group: "smalltalk" | "out_of_scope",
  input: ProcessLineAiReplyInput,
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
  history: ChatReplyHistoryItem[],
): Promise<{ replied: boolean }> {
  const autoReplyEnabled = config.autoReplyEnabled ?? LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled;
  const dryRun = config.dryRun ?? LINE_AI_SETTINGS_DEFAULTS.dryRun;
  const liveMode = autoReplyEnabled && !dryRun;

  const hasReplyToken = canUseReplyToken(config, input.canReply);
  const deliveryMode = hasReplyToken
    ? LineDeliveryMode.REPLY
    : config.allowPushFallback
      ? LineDeliveryMode.PUSH
      : LineDeliveryMode.NONE;
  const canDeliver =
    liveMode &&
    input.conversation.aiStatus === LineConversationAiStatus.ACTIVE &&
    deliveryMode !== LineDeliveryMode.NONE &&
    Boolean(config.channelAccessToken);

  const template = group === "out_of_scope" ? buildJuneOutOfScopeReply() : buildJuneSmalltalkReply();

  // Budget-aware: only spend a Gemini call when we can actually deliver AND the
  // reply-token window still has room; otherwise use the template immediately.
  const usedAi = canDeliver && replyTokenRemainingMs(config) >= SCOPED_GENERATION_MIN_BUDGET_MS;
  const reply = usedAi
    ? await (dependencies.generateScopedConversationalReply ?? generateScopedConversationalReply)({
        group,
        latestText: input.text,
        history,
      }).catch(() => template)
    : template;

  let replied = false;
  if (canDeliver && config.channelAccessToken) {
    const outboundMessage = await dependencies.appendLineMessage({
      conversationId: input.conversation.id,
      lineUserId: input.lineUserId,
      direction: LineMessageDirection.OUTBOUND_AI,
      messageType: input.messageType,
      intent: LineIntent.GREETING,
      text: reply,
      deliveryMode,
      deliveryStatus: LineDeliveryStatus.PENDING,
    });

    if (deliveryMode === LineDeliveryMode.REPLY && input.replyToken) {
      await dependencies.replyLineMessage({
        channelAccessToken: config.channelAccessToken,
        replyToken: input.replyToken,
        messages: [textMessage(reply)],
      });
    } else {
      await dependencies.pushLineMessages({
        channelAccessToken: config.channelAccessToken,
        recipientIds: [input.lineUserId],
        messages: [textMessage(reply)],
      });
    }

    await dependencies.markOutboundLineMessageSent({ messageId: outboundMessage.id, deliveryMode });
    replied = true;
  }

  fireAndForgetAudit(dependencies, {
    conversationId: input.conversation.id,
    action: "SCOPED_CONVERSATIONAL_HANDLED",
    payload: {
      lineEventId: input.lineEventId,
      group,
      replied,
      usedAi,
      deliveryMode,
    },
  });

  await dependencies.updateLineAiJob(input.jobId, {
    status: LineAiJobStatus.COMPLETED,
    result: { action: `${group}_reply`, replied, usedAi },
    finishedAt: new Date(),
  });

  return { replied };
}

/** Polite acknowledgement sent to the customer right before an admin hand-off, so
 *  the AI never goes silent. Tailored per intent. */
function handoffAckForIntent(intent: LineIntent): string {
  switch (intent) {
    case LineIntent.PAYMENT_SLIP_IMAGE:
      return "ขอบคุณค่ะ ทางร้านได้รับสลิปเรียบร้อยแล้วนะคะ 🙏\nขอเวลาให้แอดมินตรวจสอบยอดโอนสักครู่ แล้วจะแจ้งกลับให้ทราบทางแชทนี้ค่ะ";
    case LineIntent.PRICE_NEGOTIATION:
      return "เรื่องราคา/ส่วนลด เดี๋ยวแอดมินช่วยดูแลให้นะคะ 🙏 รอสักครู่ค่ะ";
    case LineIntent.CLAIM_OR_RETURN:
      return "เรื่องเคลม/เปลี่ยน-คืนสินค้า เดี๋ยวแอดมินช่วยดูแลให้นะคะ 🙏 รอสักครู่ค่ะ";
    case LineIntent.SHIPPING_ADDRESS:
      return "รับทราบเรื่องที่อยู่/การจัดส่งค่ะ 🙏 เดี๋ยวแอดมินดำเนินการให้นะคะ";
    case LineIntent.ORDER_STATUS:
      return "เดี๋ยวแอดมินช่วยเช็กสถานะ/พัสดุให้นะคะ 🙏 รอสักครู่ค่ะ";
    default:
      return "รับทราบค่ะ 🙏 เดี๋ยวแอดมินมาช่วยดูแลต่อให้นะคะ รอสักครู่ค่ะ";
  }
}

/** Fires a LineAiAuditLog write without awaiting its DB round-trip — the
 *  audit row carries debug/metric data, not state-machine truth, so the
 *  webhook pipeline shouldn't pay its latency cost. Failures degrade to a
 *  warn line; we never lose the customer reply because an audit insert
 *  flaked. The synchronous body of the dep call still runs in-place, so call
 *  ordering (and the existing test assertions on `auditActions`) is preserved. */
function fireAndForgetAudit(
  dependencies: LineWebhookProcessorDependencies,
  input: Parameters<LineWebhookProcessorDependencies["storeLineAiAudit"]>[0],
): void {
  void dependencies.storeLineAiAudit(input).catch((error) => {
    console.warn(
      "[line-webhook-processor] audit write failed",
      input.action,
      error instanceof Error ? error.message : "unknown",
    );
  });
}

/** Most recent customer turn's fitment terms (car/year), for search memory. */
function findRecentFitmentTerms(
  rows: Awaited<ReturnType<typeof getRecentLineMessagesForAi>>,
  excludeMessageId: string,
): string[] {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.id === excludeMessageId || row.direction !== LineMessageDirection.INBOUND) continue;
    const terms = extractFitmentTerms(row.text);
    if (terms.length > 0) return terms;
  }
  return [];
}

/** Maps stored LINE messages to the AI history shape (oldest → newest).
 *  Caps each turn at `HISTORY_TURN_MAX_CHARS` so an unusually long customer
 *  message can't blow the Gemini prompt budget and truncate the reply. */
const HISTORY_TURN_MAX_CHARS = 400;
function toReplyHistory(
  rows: Awaited<ReturnType<typeof getRecentLineMessagesForAi>>,
  excludeMessageId: string,
): ChatReplyHistoryItem[] {
  return rows
    .filter((row) => row.id !== excludeMessageId)
    .map((row) => {
      const fallback =
        row.messageType === LineMessageType.IMAGE
          ? "[รูปภาพ]"
          : row.messageType === LineMessageType.STICKER
            ? "[สติกเกอร์]"
            : "[ข้อความ]";
      const raw = row.text?.trim() || fallback;
      const text = raw.length > HISTORY_TURN_MAX_CHARS ? `${raw.slice(0, HISTORY_TURN_MAX_CHARS)}…` : raw;
      return {
        role: row.direction === LineMessageDirection.INBOUND ? ("customer" as const) : ("shop" as const),
        text,
      };
    });
}

/**
 * Maps a Gemini-vision image classification onto the intent-router contract so a
 * slip image is routed to the admin-only payment flow (never product search) and
 * a part image stays in the part-inquiry flow.
 */
function applyImageClassificationToRoute(
  base: ReturnType<typeof routeChatIntent>,
  classification: LineImageClassification,
  imageSearchEnabled: boolean,
): ReturnType<typeof routeChatIntent> {
  if (classification.kind === "payment_slip") {
    return {
      intent: LineIntent.PAYMENT_SLIP_IMAGE,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: `IMAGE_CLASSIFIED_PAYMENT_SLIP:${classification.reason}`,
    };
  }

  if (classification.kind === "part_image") {
    // Only auto-search from a part image when the feature flag is on AND the
    // vision step actually extracted usable hints; otherwise hand off to admin.
    const allowsSearch = imageSearchEnabled && classification.searchHints.length > 0;
    return {
      ...base,
      intent: LineIntent.PART_IMAGE_INQUIRY,
      allowsSearch,
      reason: `IMAGE_CLASSIFIED_PART:${classification.reason}:search=${allowsSearch ? "on" : "off"}`,
    };
  }

  return {
    intent: LineIntent.UNKNOWN,
    allowsSearch: false,
    requiresAdmin: true,
    requiresImageAnalysis: false,
    requiresMoreInfo: true,
    reason: `IMAGE_CLASSIFIED_UNKNOWN:${classification.reason}`,
  };
}

/** Fields of a vision classification that are worth persisting for reuse (B2a):
 *  everything the downstream pipeline reads EXCEPT the raw image bytes
 *  (`content`) and the slip `ocr` block (slips are ingested at ingest time and
 *  never re-OCR'd on reply). Keeping it lean keeps the job payload small. */
type ReusableImageClassification = Omit<LineImageClassification, "content" | "ocr">;

function serializeClassificationForReuse(c: LineImageClassification): ReusableImageClassification {
  return {
    kind: c.kind,
    intent: c.intent,
    searchHints: c.searchHints,
    confidence: c.confidence,
    reason: c.reason,
    partType: c.partType ?? null,
    carBrand: c.carBrand ?? null,
    carModel: c.carModel ?? null,
    year: c.year ?? null,
    partNumber: c.partNumber ?? null,
    chassisNumber: c.chassisNumber ?? null,
    partKind: c.partKind ?? null,
  };
}

/** Rebuilds a usable classification from a persisted payload (B2a). Returns null
 *  when the stored shape is missing/invalid so the caller falls back to a fresh
 *  vision call rather than feeding the pipeline a malformed object. */
function deserializeStoredClassification(raw: unknown): LineImageClassification | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "part_image" && o.kind !== "payment_slip" && o.kind !== "unknown_image") return null;
  return {
    kind: o.kind,
    intent: (o.intent as LineImageClassification["intent"]) ?? LineIntent.UNKNOWN,
    searchHints: Array.isArray(o.searchHints) ? (o.searchHints.filter((h) => typeof h === "string") as string[]) : [],
    confidence: o.confidence === "HIGH" || o.confidence === "MEDIUM" || o.confidence === "LOW" ? o.confidence : "LOW",
    reason: typeof o.reason === "string" ? o.reason : "REUSED_STORED_CLASSIFICATION",
    partType: typeof o.partType === "string" ? o.partType : null,
    carBrand: typeof o.carBrand === "string" ? o.carBrand : null,
    carModel: typeof o.carModel === "string" ? o.carModel : null,
    year: typeof o.year === "number" ? o.year : null,
    partNumber: typeof o.partNumber === "string" ? o.partNumber : null,
    chassisNumber: typeof o.chassisNumber === "string" ? o.chassisNumber : null,
    partKind: o.partKind === "fitment" || o.partKind === "universal" ? o.partKind : null,
    ocr: null,
  };
}

function textMessage(text: string): LinePushMessage {
  return {
    type: "text",
    text,
  };
}

// ── B2c multi-subject ────────────────────────────────────────────────────────
// Max distinct part categories answered inline in one turn. Each costs its own
// search, so we cap the fan-out and invite the customer to ask the rest.
const MULTI_SUBJECT_MAX = 3;
// LINE caps reply AND push at 5 message objects per call.
const LINE_MESSAGES_PER_SEND = 5;
const MULTI_SUBJECT_OVERFLOW_NOTE =
  "จูนขอช่วยทีละ 3 รายการก่อนนะคะ เดี๋ยวตอบให้ครบ 🙏 ส่วนรายการที่เหลือ รบกวนพิมพ์เข้ามาอีกครั้งได้เลยค่ะ เดี๋ยวจูนหาให้ต่อค่ะ 😊";
// C1: an explicit "replace" cue means the latest part supersedes the earlier one
// (answer only the latest), instead of adding it as a second subject.
const MULTI_SUBJECT_REPLACE_CUE_RE = /แทน|เปลี่ยนเป็น|เปลี่ยนเป็_|ไม่เอา.*แล้ว|ไม่เอาแล้ว|เอาเป็น/;

function buildSubjectNoMatchLine(partType: string | null, car: string | null): string {
  const subject = partType ? (car ? `${partType} ${car}` : partType) : "อะไหล่ที่แจ้ง";
  return `${subject} — จูนขอให้แอดมินช่วยเช็กให้ชัวร์ก่อนนะคะ เดี๋ยวติดต่อกลับค่ะ 🙏`;
}

/** Packs whole subject blocks into LINE sends without splitting a block across
 *  calls: the first batch goes on the reply token (≤5 messages), the rest via
 *  push (each ≤5). A block = [text] or [text, flexCard]. */
function packBlocksForDelivery(
  blocks: LinePushMessage[][],
  cap: number = LINE_MESSAGES_PER_SEND,
): { reply: LinePushMessage[]; pushes: LinePushMessage[][] } {
  const batches: LinePushMessage[][] = [[]];
  for (const block of blocks) {
    if (block.length === 0) continue;
    let last = batches[batches.length - 1];
    if (last.length + block.length > cap && last.length > 0) {
      batches.push([]);
      last = batches[batches.length - 1];
    }
    for (const message of block) last.push(message);
  }
  const reply = batches[0] ?? [];
  const pushes = batches.slice(1).filter((batch) => batch.length > 0);
  return { reply, pushes };
}

function canUseReplyToken(config: LineWebhookProcessorConfig, canReply: boolean) {
  if (!canReply || !config.channelAccessToken) return false;

  const receivedAt = config.receivedAt;
  if (!receivedAt) return true;

  const maxAgeMs = config.replyTokenMaxAgeMs ?? 45_000;
  return Date.now() - receivedAt.getTime() <= maxAgeMs;
}

/** True once an admin has taken over the chat (paused / waiting-admin / closed) —
 *  the bot must stay silent, so it also skips the typing dots. */
function isConversationAdminOwned(aiStatus: LineConversationAiStatus) {
  return (
    aiStatus === LineConversationAiStatus.PAUSED_BY_ADMIN ||
    aiStatus === LineConversationAiStatus.WAITING_ADMIN ||
    aiStatus === LineConversationAiStatus.CLOSED
  );
}

/**
 * Fires LINE's typing dots for a 1:1 chat, best-effort. Gated on live mode (AI on
 * + not dry-run) and the chat not being admin-owned, so it never shows while the
 * bot stays silent. Fire-and-forget: a failure (or a non-`U` group chatId,
 * filtered inside the helper) must never delay or break the reply. The dots clear
 * on their own when the bot sends its real message.
 */
const LOADING_DOTS_SECONDS = 60;

function maybeStartLoadingDots(
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
  params: { lineUserId: string | null; aiStatus: LineConversationAiStatus },
) {
  const autoReplyEnabled = config.autoReplyEnabled ?? LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled;
  const dryRun = config.dryRun ?? LINE_AI_SETTINGS_DEFAULTS.dryRun;
  const liveMode = autoReplyEnabled && !dryRun;

  if (
    !liveMode ||
    !config.channelAccessToken ||
    !params.lineUserId ||
    isConversationAdminOwned(params.aiStatus)
  ) {
    return;
  }

  const startLoading = dependencies.startLineLoadingAnimation ?? startLineLoadingAnimation;
  void startLoading({
    channelAccessToken: config.channelAccessToken,
    chatId: params.lineUserId,
    loadingSeconds: LOADING_DOTS_SECONDS,
  }).catch(() => {
    // Swallow: loading dots are a nicety, never a reason to fail a reply.
  });
}

// Minimum reply-token budget required to attempt an AI generation for a scoped
// conversational reply. Below this we use the deterministic template so the
// reply still goes out on the free reply token instead of timing out.
const SCOPED_GENERATION_MIN_BUDGET_MS = 8_000;

/** Reply-token budget (ms) still available before the send-early deadline. */
function replyTokenRemainingMs(config: LineWebhookProcessorConfig): number {
  const maxAgeMs = config.replyTokenMaxAgeMs ?? 45_000;
  if (!config.receivedAt) return maxAgeMs;
  return maxAgeMs - (Date.now() - config.receivedAt.getTime()) - REPLY_DEADLINE_MARGIN_MS;
}

function webhookRemainingMs(config: LineWebhookProcessorConfig): number {
  if (!config.receivedAt) return Number.POSITIVE_INFINITY;
  return WEBHOOK_MAX_DURATION_MS - (Date.now() - config.receivedAt.getTime());
}

function shouldUsePostSearchDeliveryFallback(config: LineWebhookProcessorConfig): boolean {
  return webhookRemainingMs(config) <= POST_SEARCH_DELIVERY_FALLBACK_MIN_BUDGET_MS;
}

export type ProcessLineAiReplyInput = {
  jobId: string;
  conversation: Awaited<ReturnType<typeof getOrCreateLineConversation>>;
  // Only `.id` is consumed downstream (suggestion log + history exclusion), so a
  // lightweight shape lets the coalesced path pass a merged/synthetic turn.
  inboundMessage: { id: string };
  lineUserId: string;
  replyToken: string | null;
  canReply: boolean;
  messageType: LineMessageType;
  route: ReturnType<typeof routeChatIntent>;
  text: string | null;
  imageClassification: LineImageClassification | null;
  lineEventId: string | null;
  /** Abort-on-newer hook (coalescing): called right before the reply is sent. If
   *  it resolves true, the send is skipped (a newer customer message arrived
   *  during processing) and the owner loop re-runs with the merged turn. The
   *  suggestion is still stored as a DRAFT. Default (legacy path): never aborts. */
  shouldAbortBeforeSend?: () => Promise<boolean>;
};

/** Distinct return signal so the owner loop can tell "aborted, re-run" apart
 *  from a normal completed turn. */
const COALESCE_ABORTED = "COALESCE_ABORTED" as const;

/**
 * B2c — multi-subject answer. Fires when the classifier found ≥2 DISTINCT part
 * categories in one turn (e.g. "คอมแอร์กับคอยเย็น D-Max"). Each category gets its
 * own search + deterministic block; blocks are packed onto the reply token (≤5
 * messages) with the overflow on push. Capped at 3 categories. A category with no
 * match shows a no-match line + notifies an admin WITHOUT freezing the room (other
 * categories still got real answers). Returns null when, after resolving, fewer
 * than 2 distinct categories remain — the caller then runs the normal single path.
 */
async function respondMultiSubject(
  input: ProcessLineAiReplyInput,
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
  subjects: import("@/lib/chat-core/ai-service").ChatSubject[],
): Promise<{ replied: boolean; aborted?: typeof COALESCE_ABORTED } | null> {
  if (!config.channelAccessToken) return null;

  // C1: an explicit "replace" cue ("เอา X แทน") means only the latest part stands.
  const replaceCue = MULTI_SUBJECT_REPLACE_CUE_RE.test(input.text ?? "");
  const candidateSubjects = replaceCue ? [subjects[subjects.length - 1]] : subjects;

  const resolveFitment = dependencies.resolveChatFitmentFilters ?? resolveChatFitmentFilters;
  const search = dependencies.searchChatProductInquiry;
  const summarize = dependencies.getChatProductSummaries;
  const productRoute = groupToRoute("product") ?? input.route;
  // ราคาแสดงตามระดับราคาของประเภทลูกค้า: WHOLESALE (อู่) → salePrice,
  // RETAIL (ทั่วไป/unlinked) → retailPrice; ราคา 0 → "สอบถามราคา"
  const priceTier = await (dependencies.resolveLinePriceTier ?? resolveLinePriceTier)(
    input.lineUserId,
  ).catch(() => "UNKNOWN" as const);
  if (priceTier === "UNKNOWN") {
    fireAndForgetAudit(dependencies, {
      conversationId: input.conversation.id,
      action: "PRICE_TIER_RESOLVE_FAILED",
      payload: { lineEventId: input.lineEventId, path: "multi_subject" },
    });
  }

  // Resolve each subject to a canonical category and keep the FIRST per distinct
  // category (decision 1 = ก: split on category, not car). Subjects whose category
  // doesn't resolve still split by their raw part type so we never silently merge
  // two clearly different parts.
  type ResolvedSubject = {
    subject: import("@/lib/chat-core/ai-service").ChatSubject;
    key: string;
    fitment: ChatFitmentFilters;
  };
  const byKey = new Map<string, ResolvedSubject>();
  for (const subject of candidateSubjects) {
    const fitment = await resolveFitment({
      partType: subject.partType,
      carBrand: subject.carBrand,
      carModel: subject.carModel,
      queryText: subject.query || subject.partType,
      // NOTE: do NOT pass the whole-turn raw text here — in the multi-subject path
      // it contains every subject's keyword, which would let one subject match
      // another's (higher-priority) category alias and break subject isolation.
    }).catch((): ChatFitmentFilters => ({}));
    const key = (fitment.categoryName ?? subject.partType ?? "").trim().toLowerCase();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { subject, key, fitment });
  }

  const distinct = Array.from(byKey.values());
  if (distinct.length < 2) return null; // not actually multi — let the single path run

  const kept = distinct.slice(0, MULTI_SUBJECT_MAX);
  const overflow = distinct.length > MULTI_SUBJECT_MAX;

  const placeholderImageUrl = await resolveFlexPlaceholderImageUrl().catch(() => null);
  const blocks: LinePushMessage[][] = [];
  let anyNotFound = false;

  for (const { subject, fitment } of kept) {
    const label =
      subject.query ||
      [subject.partType, subject.carModel ?? subject.carBrand].filter(Boolean).join(" ") ||
      (subject.partType ?? "");
    const productSearch = await search({
      route: productRoute,
      text: subject.query || subject.partType,
      extractedImageHints: null,
      contextHints: [],
      fitmentHints: {
        categoryName: fitment.categoryName ?? null,
        carBrandName: fitment.carBrandName ?? null,
        carModelName: fitment.carModelName ?? null,
        fitmentYear: subject.year ?? null,
      },
    }).catch(() => null);

    const ids = productSearch?.searched ? productSearch.result.ids : [];
    const products = applyChatPriceTier(
      ids.length > 0 ? await summarize(ids).catch(() => []) : [],
      priceTier,
    );

    if (products.length === 0) {
      anyNotFound = true;
      const car = [subject.carBrand, subject.carModel].filter(Boolean).join(" ") || null;
      blocks.push([textMessage(buildSubjectNoMatchLine(subject.partType, car))]);
      continue;
    }

    const text = buildJuneDeadlineReply({
      query: label,
      products,
      known: {
        partType: subject.partType,
        carBrand: subject.carBrand,
        carModel: subject.carModel,
        year: subject.year,
      },
    });
    const flex =
      productSearch && productSearch.searched
        ? buildProductFlexMessage({
            products,
            searchQuery: productSearch.query,
            total: productSearch.result.total,
            placeholderImageUrl,
            filters: {
              categoryName: productSearch.appliedFilters.categoryName,
              carBrandName: productSearch.appliedFilters.carBrandName,
              carModelName: productSearch.appliedFilters.carModelName,
              year: productSearch.appliedFilters.fitmentYear,
            },
          })
        : null;
    blocks.push(flex ? [textMessage(text), flex] : [textMessage(text)]);
  }

  if (overflow) blocks.push([textMessage(MULTI_SUBJECT_OVERFLOW_NOTE)]);

  // Abort-on-newer (coalescing): a newer message arrived → re-run with the merged
  // turn instead of sending a now-stale multi answer.
  if (input.shouldAbortBeforeSend) {
    const abort = await input.shouldAbortBeforeSend().catch(() => false);
    if (abort) {
      await dependencies.updateLineAiJob(input.jobId, {
        status: LineAiJobStatus.COMPLETED,
        result: { action: "coalesce_aborted", replied: false },
        finishedAt: new Date(),
      });
      return { replied: false, aborted: COALESCE_ABORTED };
    }
  }

  const { reply, pushes } = packBlocksForDelivery(blocks);
  const hasReplyToken = canUseReplyToken(config, input.canReply) && Boolean(input.replyToken);

  let replied = false;
  const sendBatch = async (messages: LinePushMessage[], mode: LineDeliveryMode) => {
    if (messages.length === 0) return;
    const outbound = await dependencies.appendLineMessage({
      conversationId: input.conversation.id,
      lineUserId: input.lineUserId,
      direction: LineMessageDirection.OUTBOUND_AI,
      messageType: input.messageType,
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      text: messages[0]?.type === "text" ? messages[0].text : "[การ์ดสินค้า]",
      deliveryMode: mode,
      deliveryStatus: LineDeliveryStatus.PENDING,
    });
    if (mode === LineDeliveryMode.REPLY && input.replyToken) {
      await dependencies.replyLineMessage({
        channelAccessToken: config.channelAccessToken!,
        replyToken: input.replyToken,
        messages,
      });
    } else {
      await dependencies.pushLineMessages({
        channelAccessToken: config.channelAccessToken!,
        recipientIds: [input.lineUserId],
        messages,
      });
    }
    await dependencies.markOutboundLineMessageSent({ messageId: outbound.id, deliveryMode: mode });
    replied = true;
  };

  // First batch on the free reply token when it's still open; otherwise push (when
  // a push fallback is allowed). Remaining batches always go via push.
  if (reply.length > 0) {
    if (hasReplyToken) await sendBatch(reply, LineDeliveryMode.REPLY);
    else if (config.allowPushFallback) await sendBatch(reply, LineDeliveryMode.PUSH);
  }
  for (const batch of pushes) {
    if (config.allowPushFallback || !hasReplyToken) await sendBatch(batch, LineDeliveryMode.PUSH);
  }

  fireAndForgetAudit(dependencies, {
    conversationId: input.conversation.id,
    action: "AI_MULTI_SUBJECT",
    payload: {
      lineEventId: input.lineEventId,
      subjects: kept.length,
      overflow,
      anyNotFound,
      replaceCue,
      replied,
    },
  });

  // A missing category → tell an admin (no freeze: other categories were answered
  // and the AI stays active per decision จ).
  if (anyNotFound) {
    const notify = dependencies.notifyLineOaNeedsAdmin ?? notifyLineOaNeedsAdmin;
    const countPending =
      dependencies.countPendingPaymentSlipsForConversation ?? countPendingPaymentSlipsForConversation;
    const pendingSlipCount = await countPending(input.conversation.id).catch(() => 0);
    await notify({
      conversationId: input.conversation.id,
      displayName: input.conversation.displayName,
      text: input.text,
      messageType: input.messageType,
      pendingSlipCount,
    }).catch(() => undefined);
  }

  await dependencies.updateLineAiJob(input.jobId, {
    status: LineAiJobStatus.COMPLETED,
    result: { action: "multi_subject", subjects: kept.length, replied },
    finishedAt: new Date(),
  });

  return { replied };
}

export async function processLineAiReply(
  input: ProcessLineAiReplyInput,
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
) {
  const startedAt = new Date();
  const pipelineStartedAtMs = Date.now();
  await dependencies.updateLineAiJob(input.jobId, {
    status: LineAiJobStatus.PROCESSING,
    startedAt,
  });

  // "เมนู" opens LINE's rich menu — ignore it entirely (no reply, no handoff, AI
  // stays active and waits for the next message).
  if (isMenuCommand(input.text)) {
    await dependencies.updateLineAiJob(input.jobId, {
      status: LineAiJobStatus.COMPLETED,
      result: { action: "ignored_menu_command" },
      finishedAt: new Date(),
    });
    return { replied: false };
  }

  // Stickers never enter the search / hand-off / notify pipeline — greet once on a
  // fresh contact, otherwise stay silent (see handleStickerEvent).
  if (input.messageType === LineMessageType.STICKER) {
    return handleStickerEvent(input, config, dependencies);
  }

  // No-content noise ("...", "??", emoji-only) — stay silent. Crucially, never let
  // it reach the classifier, which would otherwise pull the previous subject from
  // chat history and re-answer a question the customer never re-asked.
  if (isNoiseText(input.text)) {
    fireAndForgetAudit(dependencies, {
      conversationId: input.conversation.id,
      action: "NOISE_IGNORED",
      payload: { lineEventId: input.lineEventId, text: input.text ?? null },
    });
    await dependencies.updateLineAiJob(input.jobId, {
      status: LineAiJobStatus.COMPLETED,
      result: { action: "ignored_noise" },
      finishedAt: new Date(),
    });
    return { replied: false };
  }

  try {
    const autoReplyEnabled = config.autoReplyEnabled ?? LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled;
    const dryRun = config.dryRun ?? LINE_AI_SETTINGS_DEFAULTS.dryRun;

    // Recent turns power both the reply's short-term memory and the search context.
    // (Level 1) Bound them to the CURRENT session — a long idle gap starts a new
    // session, so the classifier can't consolidate a subject from a previous,
    // unrelated conversation.
    const recentMessagesRaw = await (dependencies.getRecentLineMessagesForAi ?? getRecentLineMessagesForAi)(
      input.conversation.id,
      10,
    ).catch(() => []);
    const recentMessages = boundMessagesToSession(recentMessagesRaw);
    const history = toReplyHistory(recentMessages, input.inboundMessage.id);

    // ── Routing: AI intent classification (Layer-2) ───────────────────────────
    // Layer-1 (regex) already produced input.route. For high-stakes groups
    // (payment/price/claim/purchase) the keyword match is AUTHORITATIVE — we don't
    // ask the AI (guard). Otherwise the AI classifies the message into a group; on
    // failure we fall back to the deterministic Layer-1 result so the turn never
    // breaks. The classifier also distils the consolidated product query/hints.
    // Image turns keep their existing image route (PART_IMAGE_INQUIRY /
    // PAYMENT_SLIP_IMAGE from the vision classifier) — the text classifier only
    // applies to text messages.
    const isTextTurn = input.messageType === LineMessageType.TEXT;
    const layer1Group = intentToGroup(input.route.intent);
    // Price/purchase keyword hits are NO LONGER a hard skip — a message like
    // "หม้อน้ำ d-max ราคาเท่าไหร่" must be classified so it can route to product
    // (search + show), not a blind admin hand-off. Only payment/claim stay
    // authoritative (those are genuinely admin-only).
    const hardGuard =
      layer1Group === "payment" ||
      layer1Group === "claim_or_return" ||
      input.route.reason === "SERVICE_INQUIRY_KEYWORD";
    // True when the regex flagged a price/buy intent — used to (a) skip the
    // purchase hand-off when it's really a price *inquiry* we can answer with
    // products, and (b) append a "price → admin" note after the matches.
    const regexPriceIntent =
      input.route.intent === LineIntent.PURCHASE_INTENT ||
      input.route.intent === LineIntent.PRICE_NEGOTIATION;
    const priceQuestionIntent =
      input.route.intent === LineIntent.PRICE_NEGOTIATION || PRICE_QUESTION_RE.test(input.text ?? "");
    const shouldClassify = isTextTurn && !hardGuard;
    // Space-split glued Thai+digit queries ("วาล์วโตโยต้า134" → "วาล์วโตโยต้า 134")
    // before the AI/search pipeline reads them, so model-code/year anchors tokenize
    // and the search guards engage. The raw input.text stays untouched for
    // storage/echo/audit.
    const processText = normalizeInboundChatQuery(input.text);

    // Hybrid A (rule-first): when the message is a fully-known, self-contained
    // product query (part + vehicle, or a code) we derive the intent from the
    // SearchKeyword dictionary and SKIP the Gemini classifier. Gated on
    // `contextFree` so a query that might depend on conversational context (e.g. a
    // bare part or bare vehicle that an earlier turn would complete) still goes
    // through the LLM, preserving LINE's context-merge behaviour.
    const knownIntent = shouldClassify
      ? await resolveKnownQueryIntent(processText).catch(() => null)
      : null;
    const ruleSearchIntent: ChatSearchIntent | null =
      knownIntent && knownIntent.contextFree
        ? {
            group: "product",
            query: knownIntent.query,
            isProductQuery: true,
            partType: knownIntent.categoryName,
            carBrand: knownIntent.carBrandName,
            carModel: knownIntent.carModelName,
            year: knownIntent.fitmentYear,
            partKind: null,
            tooBroad: false,
          }
        : null;

    const extractedPriceSubjects =
      regexPriceIntent || priceQuestionIntent ? extractPriceProductSubjectsFromText(processText) : [];
    const priceSubjectIntent = buildPriceProductSearchIntent(extractedPriceSubjects);

    const rawSearchIntent = ruleSearchIntent
      ? ruleSearchIntent
      : shouldClassify
        ? await (dependencies.extractChatSearchIntent ?? extractChatSearchIntent)({
            intent: input.route.intent,
            latestText: processText,
            history,
          }).catch(() => null)
        : null;
    const usedRuleIntent = ruleSearchIntent !== null;
    const searchIntent = priceSubjectIntent ?? rawSearchIntent;
    const classifierProductHasCurrentEvidence =
      priceQuestionIntent &&
      searchIntent?.group === "product" &&
      [
        searchIntent.partType,
        searchIntent.carBrand,
        searchIntent.carModel,
        searchIntent.year === null || searchIntent.year === undefined ? null : String(searchIntent.year),
      ].some((value) => value && lineValueHasCustomerEvidence(value, processText, []));
    const priceTurnHasCurrentProductEvidence =
      priceQuestionIntent &&
      (extractedPriceSubjects.length > 0 ||
        extractChatRequiredSearchTokens(processText).length > 0 ||
        classifierProductHasCurrentEvidence);
    const keepPriceTurnAsAdminIntent =
      priceQuestionIntent && !priceTurnHasCurrentProductEvidence;
    const effectiveSearchIntent = keepPriceTurnAsAdminIntent ? null : searchIntent;
    const classifyFailed = shouldClassify && !usedRuleIntent && rawSearchIntent === null && priceSubjectIntent === null;
    const group: ChatMessageGroup = shouldClassify
      ? keepPriceTurnAsAdminIntent
        ? layer1Group
        : effectiveSearchIntent?.group ?? layer1Group
      : layer1Group;

    // Effective route from the group (reuses the existing forced-response / hand-off
    // / policy machinery). general_faq / social / other have no 1:1 intent → keep
    // the Layer-1 route and drive them with the flags below. Non-text turns keep
    // their original route untouched.
    const route = isTextTurn ? groupToRoute(group) ?? input.route : input.route;
    const classifierUncertain =
      isTextTurn && classifyFailed && route.intent === LineIntent.PRODUCT_INQUIRY_TEXT;
    const tryFaqThenAsk = isTextTurn && (group === "general_faq" || group === "other");

    fireAndForgetAudit(dependencies, {
      conversationId: input.conversation.id,
      action: "INTENT_CLASSIFIED",
      payload: {
        lineEventId: input.lineEventId,
        group,
        source: hardGuard
          ? "regex_guard"
          : !isTextTurn
            ? "image_route"
            : usedRuleIntent
              ? "rule_dictionary"
              : priceSubjectIntent
                ? "price_subject_rule"
              : classifyFailed
                ? "regex_fallback"
                : "ai",
        routedIntent: route.intent,
      },
    });

    // social (ขอบคุณ/โอเค) → brief ack, or stay silent when it's just a closing
    // ack right after the shop replied. Handled inline like a sticker.
    if (group === "social") {
      return handleSocialTurn(input, config, dependencies, history);
    }

    // smalltalk (จูนคือใคร/ทำอะไรได้) / out_of_scope (นอกเรื่องร้าน) → the AI
    // writes its own scoped reply (in จูน's voice, bounded to the role, always
    // steering back to parts). Never an admin hand-off.
    if (group === "smalltalk" || group === "out_of_scope") {
      return handleScopedConversationalTurn(group, input, config, dependencies, history);
    }

    // B2c — multi-subject: the customer asked for ≥2 DISTINCT part types in one
    // turn ("คอมแอร์กับคอยเย็น D-Max"). Answer each category in its own block
    // instead of mashing them into one mushy query. respondMultiSubject returns
    // null if, after resolving, only one distinct category remains (e.g. same part
    // for two cars) — then we fall through to the normal single-subject path.
    const multiSubjects = group === "product" ? effectiveSearchIntent?.subjects ?? null : null;
    if (
      autoReplyEnabled &&
      !dryRun &&
      multiSubjects &&
      multiSubjects.length >= 2 &&
      !isConversationAdminOwned(input.conversation.aiStatus)
    ) {
      const multi = await respondMultiSubject(input, config, dependencies, multiSubjects);
      if (multi) return multi;
    }

    // Intent-gated retrieval: only `product` turns search + attach cards. Every
    // other group answers from a template/FAQ or hands off — so stale product
    // context can never leak into answers to "ร้านอยู่ที่ไหน" etc.
    const isNonProductTurn = group !== "product";
    // DB-backed Thai↔English brand spellings (cached, best-effort) so the guard can
    // ground a brand the customer typed in Thai ("โตโยต้า" → "Toyota").
    const [brandLookup, modelLookup] = isNonProductTurn
      ? [null, null]
      : await Promise.all([
          (dependencies.loadCarBrandVariantLookup ?? loadCarBrandVariantLookup)().catch(() => null),
          (dependencies.loadCarModelVariantLookup ?? loadCarModelVariantLookup)().catch(() => null),
        ]);
    const guardedSearch = isNonProductTurn
      ? { intent: effectiveSearchIntent, forceLiteralQuery: false, requiredTokens: [] }
      : guardChatSearchIntent({ intent: effectiveSearchIntent, latestText: processText, history, brandLookup, modelLookup });
    const guardedSearchIntent = guardedSearch.intent;
    const classifierQuery = isNonProductTurn
      ? null
      : guardedSearch.forceLiteralQuery
        ? input.text?.trim() || null
        : guardedSearchIntent?.query ?? null;

    // Part-image search hints that are trustworthy enough to feed the query: a LOW
    // read's guesses are dropped (an image-only LOW turn is blocked from searching;
    // a LOW photo sent WITH text lets the text drive). Code-like tokens are handled
    // separately (validated against the catalog) so they stay reliable regardless.
    const trustedImageSearchHints =
      input.imageClassification?.kind === "part_image" &&
      input.imageClassification.confidence !== "LOW"
        ? input.imageClassification.searchHints
        : [];

    // ── Inquiry frame (conversation slot memory: levels 2 + 3) ────────────────
    // Carry the customer's CURRENT product subject {part, car, year} across turns,
    // merging drip-fed detail and RESETTING the part on a topic shift. The frame
    // is the single source of fitment context downstream, so a sparse follow-up
    // ("ปี 03") continues the real subject instead of the classifier guessing from
    // raw history. Only for product turns.
    let inquiryFrame: InquiryFrame | null = null;
    let frameTopicShift = false;
    if (!isNonProductTurn) {
      const loadFrame = dependencies.getLineInquiryFrame ?? getLineInquiryFrame;
      const saveFrame = dependencies.updateLineInquiryFrame ?? updateLineInquiryFrame;
      const stored = await loadFrame(input.conversation.id).catch(() => null);
      const sessionStale = isFrameStale(stored?.updatedAt ?? null);
      // Fields read off a part image (registration plate → brand, part photo →
      // part type) feed the frame too, so an image turn carries its fitment
      // context into the next text turn and we never re-ask for detail the photo
      // already contained. The chassis/VIN is deliberately NOT carried — it is
      // not a searchable fitment slot.
      // Uncertain OCR must not poison the frame — "ห้ามเดา". The frame becomes a
      // PERSISTENT hard fitment filter, so only let vision fields seed the running
      // subject when the classifier was HIGH-confident. A MEDIUM read is still
      // usable as a SOFT search hint (imageSearchHints below) but never a slot;
      // a LOW read is handled by asking for confirmation instead.
      const imageFields =
        input.imageClassification?.kind === "part_image" &&
        input.imageClassification.confidence === "HIGH"
          ? input.imageClassification
          : null;
      // Search hints from the photo (LOW reads already dropped — see
      // trustedImageSearchHints above) so a blurry photo can't drift the search.
      const imageSearchHints = trustedImageSearchHints;
      const imageRequiredTokens = extractChatRequiredSearchTokens(imageSearchHints.join(" "));
      const latestHasVehicleEvidence = Boolean(
        guardedSearchIntent?.carBrand ||
          guardedSearchIntent?.carModel ||
          guardedSearchIntent?.year ||
          imageFields?.carBrand ||
          imageFields?.carModel ||
          imageFields?.year,
      );
      const latestHasProductSpecificity = Boolean(
        imageFields ||
          guardedSearch.requiredTokens.length > 0 ||
          imageRequiredTokens.length > 0,
      );
      // Finer than `latestHasVehicleEvidence`: did THIS turn pin a specific car
      // (model/year), or only name a bare brand? A brand-only mention with a new
      // part is a brand-scoped fresh query, not a continuation of the prior car's
      // exact model/year.
      const latestHasModelOrYearEvidence = Boolean(
        guardedSearchIntent?.carModel ||
          guardedSearchIntent?.year ||
          imageFields?.carModel ||
          imageFields?.year,
      );
      // partType grounding (mirror the brand/model/year evidence gate in
      // guardChatSearchIntent). The classifier can hallucinate a common part
      // ("คอยล์เย็น") for a vehicle-only follow-up ("Vios gen3 ปี2013") — which
      // would then override the part the customer actually established (often from
      // an image) and flip the frame to the wrong category. Trust the classifier's
      // partType only when it came from a NEW image this turn, OR the customer's own
      // text evidences it. Gated on there being a STORED part to fall back to, so a
      // fresh first-mention (no prior part) still classifies as before.
      const classifierPartType = guardedSearchIntent?.partType ?? null;
      const imagePartType = imageFields?.partType ?? null;
      // The evidence gate below guards against the LLM HALLUCINATING a part for a
      // vehicle-only follow-up. The rule-dictionary path cannot hallucinate — every
      // token was resolved from the customer's own words against SearchKeyword — and
      // it sets partType to the full canonical category name ("หม้อน้ำ (Radiator)"),
      // whose "(English)" suffix the customer never types, so the raw evidence check
      // always fails and would wrongly drop a legitimate part. Trust rule-derived
      // partType verbatim; only evidence-gate the LLM classifier's partType.
      // The classifier already spell-corrects the customer's part word (e.g. reads
      // "คอล์ยเย็น" as "คอยล์เย็น"). Before dropping that corrected part as an
      // ungrounded hallucination we must let it stand when there is ANY textual basis
      // for it — literal OR a misspelling of it — so a real (mis-keyed) part flows on
      // to category resolution / LLM correction and its products get shown, instead of
      // re-asking for the part the customer already gave.
      //  - Fix 1: a STALE session has no live stored part to protect, so never drop —
      //    trust this turn's classifier part outright.
      //  - Fix 2: a MISSPELLING of the part in the customer's text counts as evidence
      //    (lineValueHasCustomerTypoEvidence), so a typo'd part is kept, not dropped.
      // The hallucination guard still fires when the customer named NO part at all
      // (vehicle-only follow-up): no literal AND no typo evidence → dropped as before.
      const groundedLatestPartType =
        imagePartType ??
        (!usedRuleIntent &&
        !sessionStale &&
        stored?.partType &&
        classifierPartType &&
        !lineValueHasCustomerEvidence(classifierPartType, processText, history) &&
        !lineValueHasCustomerTypoEvidence(classifierPartType, processText, history)
          ? null
          : classifierPartType);

      const reconciled = reconcileInquiryFrame(
        stored
          ? { partType: stored.partType, carBrand: stored.carBrand, carModel: stored.carModel, year: stored.year }
          : null,
        {
          partType: groundedLatestPartType,
          carBrand: guardedSearchIntent?.carBrand ?? imageFields?.carBrand ?? null,
          carModel: guardedSearchIntent?.carModel ?? imageFields?.carModel ?? null,
          // The classifier reports a single 4-digit C.E. year and often returns
          // null for a colloquial range ("12-15"). Deterministically parse the
          // range's START year from the customer's own text as a fallback so the
          // fitment-year filter still applies (e.g. "คอยเย็น Avanza 12-15" → 2012).
          // Grounded in customer text by construction, so it survives the year guard.
          year: guardedSearchIntent?.year ?? imageFields?.year ?? parseCarYearRangeStart(processText) ?? null,
        },
        {
          sessionStale,
          // Pass the classifier's raw (pre-grounding) part word so the frame can
          // tell a misspelled NEW part ("วาว์ล") from a pure vehicle-only
          // follow-up when the vehicle changes — see reconcileInquiryFrame.
          latestClassifierPartType: classifierPartType ?? imagePartType ?? null,
        },
      );
      inquiryFrame = reconciled.frame;
      frameTopicShift = reconciled.topicShift;
      const droppedStalePartOnVehicleSwitch = reconciled.droppedStalePart;
      const droppedVehicleCarryover = Boolean(
        inquiryFrame &&
          !latestHasVehicleEvidence &&
          latestHasProductSpecificity &&
          (inquiryFrame.carBrand || inquiryFrame.carModel || inquiryFrame.year),
      );
      const keepFreshVehicleForImagePartShift = Boolean(
        droppedVehicleCarryover &&
          frameTopicShift &&
          !sessionStale &&
          imageFields?.partKind === "fitment" &&
          (stored?.carBrand || stored?.carModel || stored?.year),
      );
      if (droppedVehicleCarryover && !keepFreshVehicleForImagePartShift && inquiryFrame) {
        inquiryFrame = {
          ...inquiryFrame,
          carBrand: null,
          carModel: null,
          year: null,
        };
      }
      // Brand-only fresh query: this turn names a new part AND a car brand, but NO
      // model/year. A model/year carried over from a previous part inquiry (e.g.
      // earlier "...ยาริสปี08") would otherwise hard-filter the search to the wrong
      // car and hide valid brand-wide matches — "วาล์วโตโยต้า134" must search all
      // Toyota valves, not stay pinned to Yaris 2008. Keep the brand, drop the
      // stale model/year. (Only reachable once the part anchor tokenizes, i.e.
      // latestHasProductSpecificity is true.)
      const droppedStaleModelYear = Boolean(
        inquiryFrame &&
          !droppedVehicleCarryover &&
          latestHasProductSpecificity &&
          latestHasVehicleEvidence &&
          !latestHasModelOrYearEvidence &&
          (inquiryFrame.carModel || inquiryFrame.year),
      );
      if (droppedStaleModelYear && inquiryFrame) {
        inquiryFrame = {
          ...inquiryFrame,
          carModel: null,
          year: null,
        };
      }
      // G2 (small) — the customer switched to a VEHICLE CLASS this turn (สิบล้อ /
      // รถบรรทุก / เทรลเลอร์ — never a resolvable CarModel) while naming NO new part
      // (classifier + image both silent) and it is NOT a continuation ("แล้ว/และ/
      // หรือ/…ล่ะ"). A specific part carried from a prior turn ("สายแอร์") would
      // otherwise hard-filter this class inquiry to the old category and surface
      // another vehicle class's parts. Drop the carried part so the turn asks for the
      // part / hands off. Broadness (the G1 gate) and continuations both take
      // precedence per the owner's decision.
      const droppedCarriedPartOnVehicleClassSwitch = Boolean(
        inquiryFrame &&
          inquiryFrame.partType &&
          !classifierPartType &&
          !imagePartType &&
          namesVehicleClassTerm(processText) &&
          !hasFollowUpConnective(processText),
      );
      if (droppedCarriedPartOnVehicleClassSwitch && inquiryFrame) {
        inquiryFrame = { ...inquiryFrame, partType: null };
      }
      const broadInquiryFrame = isBroadChatPartType(inquiryFrame.partType);
      if (!broadInquiryFrame) {
        await saveFrame({ conversationId: input.conversation.id, ...inquiryFrame }).catch(() => undefined);
      }

      fireAndForgetAudit(dependencies, {
        conversationId: input.conversation.id,
        action: "INQUIRY_FRAME",
        payload: {
          lineEventId: input.lineEventId,
          partType: inquiryFrame.partType,
          carBrand: inquiryFrame.carBrand,
          carModel: inquiryFrame.carModel,
          year: inquiryFrame.year,
          topicShift: frameTopicShift,
          sessionStale,
          droppedVehicleCarryover,
          droppedStalePartOnVehicleSwitch,
          droppedCarriedPartOnVehicleClassSwitch,
          classifierPartType,
          latestHasProductSpecificity,
          broadInquiryFrame,
        },
      });
    }

    const frameQuery = inquiryFrame ? buildFrameQuery(inquiryFrame) : null;
    const frameYear = inquiryFrame?.year ?? null;
    // Effective search query: on a topic shift rebuild from the new subject (drop
    // the classifier's history-merged query); otherwise prefer the classifier's
    // consolidated query, falling back to the frame for context the 10-message
    // window may have dropped within a long session.
    const consolidatedQuery = isNonProductTurn
      ? null
      : frameTopicShift
        ? frameQuery ?? input.text?.trim() ?? null
        : classifierQuery ?? frameQuery;

    // Pre-search completeness gate: only when the classifier gave structured
    // fields (text turns). Decides whether we have enough to search, and if so
    // whether to nudge the customer for one more detail AFTER showing matches.
    // When there are no structured fields (Gemini off / image-only / first turn)
    // we degrade to the legacy "search then ask if empty" behaviour.
    // Image-only turns have no text classifier — gate from the structured OCR
    // fields instead, but only when vision was confident enough to label the
    // part kind (otherwise degrade to legacy search-on-hints, never blocking).
    const imageGateDecision =
      input.imageClassification?.kind === "part_image" && input.imageClassification.partKind
        ? decideChatSearchGate({
            partType: input.imageClassification.partType ?? null,
            carBrand: input.imageClassification.carBrand ?? null,
            carModel: input.imageClassification.carModel ?? null,
            year: input.imageClassification.year ?? null,
            partKind: input.imageClassification.partKind,
            tooBroad: false,
          })
        : null;
    const rawGateDecision =
      !isNonProductTurn && inquiryFrame && (inquiryFrame.partType || inquiryFrame.carModel || inquiryFrame.carBrand)
        ? decideChatSearchGate({
            // Completeness is judged against the carried FRAME, so a follow-up that
            // only adds the year still counts the part + car from earlier turns.
            partType: inquiryFrame.partType,
            carBrand: inquiryFrame.carBrand,
            carModel: inquiryFrame.carModel,
            year: frameYear,
            partKind: guardedSearchIntent?.partKind ?? null,
            tooBroad: guardedSearchIntent?.tooBroad ?? false,
          })
        : imageGateDecision;
    // G1 — broad-inquiry detection on THIS turn's actual message. The gate above
    // judges completeness from the carried FRAME partType, so a stale specific part
    // ("สายแอร์" carried from a prior turn) can hide a broad NEW ask ("อะไหล่แอร์
    // สิบล้อ HINO ISUZU") — which then searches and hard-filters to that carried
    // category, answering with narrow, wrong-vehicle-class parts (e.g. D-Max pickup
    // A/C hoses for a ten-wheel-truck question). When the customer's own text/query
    // this turn is broad, force the BROAD_PART_TYPE ask so it hands off instead of
    // masking the broad ask with carried results. (Messenger already does this via
    // isBroadChatPartType(processText) in resolveMessengerFitmentHints.)
    const latestTurnIsBroadInquiry =
      !isNonProductTurn &&
      (isBroadChatPartType(consolidatedQuery) || isBroadChatPartType(processText));
    const gateDecision = latestTurnIsBroadInquiry
      ? { action: "ask" as const, ask: "need_part" as const, reason: "BROAD_PART_TYPE" }
      : rawGateDecision?.action === "ask" &&
          rawGateDecision.ask === "need_car" &&
          Boolean(
            guardedSearch.requiredTokens.length ||
              extractChatRequiredSearchTokens(trustedImageSearchHints.join(" ")).length,
          )
        ? { action: "search" as const, followUp: null, reason: "specific_latest_turn_without_car" }
        : rawGateDecision;
    const gateBlocksSearch = gateDecision?.action === "ask";
    const searchFollowUp = gateDecision?.action === "search" ? gateDecision.followUp : null;
    // A part-image turn already spent vision OCR time we paid for; bailing to a
    // "tell me more" reply BEFORE searching throws that away. Run the search
    // regardless — the delivery step sends on the reply token if it's still open,
    // otherwise PUSHes the result afterward.
    // "ห้ามเดา": a lone image whose OCR came back low-confidence is too uncertain
    // to search blindly — ask the customer to confirm instead of guessing. (An
    // image sent WITH text is driven by the text, so this only fires image-only.)
    const imageOnlyLowConfidence =
      !isTextTurn &&
      input.imageClassification?.kind === "part_image" &&
      input.imageClassification.confidence === "LOW";

    // ── Product-code fast-path (Option A) ─────────────────────────────────────
    // A customer who browsed the shop site/app often sends the product's code
    // ("สอบถามราคา P0368") or a screenshot whose vision OCR captured the printed
    // part number. A code alone identifies the item, so when one RESOLVES to a
    // real catalog product we answer with THAT product only when this turn has
    // no fitment evidence: exact-code search
    // (extractedPartNumber wins the query), no completeness gate, no fitment hard
    // filters, no "which car?" ask. If category / brand / model / year exists in
    // this turn, fitment filters win. Candidates come from the customer's own text,
    // the image's OCR'd part number, and any code-like image hints — validated
    // against the catalog so a misread/unknown code falls back to the normal flow.
    // Skipped for admin-only guarded turns (payment/claim) and payment-slip images.
    const isPaymentSlipImage = input.imageClassification?.kind === "payment_slip";
    const codeCandidates =
      !hardGuard && !isPaymentSlipImage
        ? Array.from(
            new Set(
              [
                ...extractChatRequiredSearchTokens(processText),
                ...(input.imageClassification?.partNumber
                  ? extractChatRequiredSearchTokens(input.imageClassification.partNumber)
                  : []),
                ...extractChatRequiredSearchTokens(
                  (input.imageClassification?.searchHints ?? []).join(" "),
                ),
              ].filter((token) => Boolean(token) && isDirectProductCodeToken(token)),
            ),
          )
        : [];
    const resolvedCatalogCodes =
      codeCandidates.length > 0
        ? new Set(
            await (dependencies.resolveCatalogCodes ?? resolveCatalogCodes)(codeCandidates).catch(
              () => [] as string[],
            ),
          )
        : new Set<string>();
    // First candidate (customer text > image part number > image hints) that exists.
    const directProductCodeCandidate = codeCandidates.find((code) => resolvedCatalogCodes.has(code)) ?? null;

    // Resolve the AI's brand/model/part-type hints to canonical master-data names
    // for use as precise hard filters (drops anything that doesn't resolve, so a
    // typo can never zero-out the search — the free-text query still runs).
    const resolveFitment = dependencies.resolveChatFitmentFilters ?? resolveChatFitmentFilters;
    let fitmentFilters: ChatFitmentFilters =
      !isNonProductTurn && inquiryFrame
        ? await resolveFitment({
            partType: inquiryFrame.partType,
            carBrand: inquiryFrame.carBrand,
            carModel: inquiryFrame.carModel,
            queryText: consolidatedQuery ?? processText,
            rawText: processText,
          }).catch((): ChatFitmentFilters => ({}))
        : {};
    const hasCurrentTurnFitmentEvidence = Boolean(
      guardedSearchIntent?.partType ||
        guardedSearchIntent?.carBrand ||
        guardedSearchIntent?.carModel ||
        guardedSearchIntent?.year ||
        input.imageClassification?.partType ||
        input.imageClassification?.carBrand ||
        input.imageClassification?.carModel ||
        input.imageClassification?.year,
    );
    const directProductCode = hasCurrentTurnFitmentEvidence ? null : directProductCodeCandidate;

    // ── LLM category fallback ──────────────────────────────────────────────
    // The deterministic resolver could not map a category (often a misspelled
    // part word, e.g. "วาว์ล" → "วาล์วแอร์"). Only on a text product turn that
    // will actually search: ask the LLM to correct the spelling, then RE-MAP the
    // corrected word through the SAME deterministic resolver. Apply it only when
    // that yields a real category — so the map stays grounded in the alias table,
    // never a raw LLM guess. On success, stage the misspelling as a PENDING alias
    // for admin review (fire-and-forget; no customer-latency impact).
    if (
      !isNonProductTurn &&
      isTextTurn &&
      !fitmentFilters.categoryName &&
      !directProductCode &&
      !gateBlocksSearch &&
      !imageOnlyLowConfidence &&
      !isBroadChatPartType(inquiryFrame?.partType) &&
      !isBroadChatPartType(consolidatedQuery ?? processText) &&
      Boolean(consolidatedQuery ?? processText)
    ) {
      const correction = await (dependencies.correctPartSpelling ?? correctPartSpelling)(processText, {
        carBrand: inquiryFrame?.carBrand ?? fitmentFilters.carBrandName ?? null,
        carModel: inquiryFrame?.carModel ?? fitmentFilters.carModelName ?? null,
      }).catch(() => null);
      if (correction?.corrected) {
        const remapped = await resolveFitment({
          partType: correction.corrected,
          carBrand: inquiryFrame?.carBrand ?? null,
          carModel: inquiryFrame?.carModel ?? null,
          queryText: correction.corrected,
          rawText: correction.corrected,
        }).catch((): ChatFitmentFilters => ({}));
        if (remapped.categoryName) {
          fitmentFilters = {
            ...fitmentFilters,
            categoryName: remapped.categoryName,
            carBrandName: fitmentFilters.carBrandName ?? remapped.carBrandName,
            carModelName: fitmentFilters.carModelName ?? remapped.carModelName,
          };
          fireAndForgetAudit(dependencies, {
            conversationId: input.conversation.id,
            action: "CATEGORY_LLM_FALLBACK",
            payload: {
              lineEventId: input.lineEventId,
              original: correction.original,
              corrected: correction.corrected,
              categoryName: remapped.categoryName,
            },
          });
          // Stage the misspelling for admin review — never block the reply on it.
          void stageAiCategoryAlias({
            alias: correction.original,
            categoryName: remapped.categoryName,
            correctedTerm: correction.corrected,
            originalText: correction.original,
          }).catch(() => undefined);
        }
      }
    }

    // When the AI gave us a consolidated query it already merged the whole
    // subject, so the narrow fitment carryover is redundant. Otherwise keep the
    // deterministic carryover so a follow-up with no car/year still stays on-target.
    const contextHints = consolidatedQuery
      ? []
      : extractFitmentTerms(input.text).length > 0
        ? []
        : findRecentFitmentTerms(recentMessages, input.inboundMessage.id);

    // Accessory precision anchor: a universal/accessory inquiry (ฟองน้ำ, โอริง, น็อต,
    // น้ำยา…) resolves to NO category, so the broad search can drift into other
    // accessories that share generic tokens ("แอร์") or are semantic neighbours.
    // Pass the head noun so the bridge can keep results on-topic (with a graceful
    // fallback). Gated on accessory intent + no category → fitment parts untouched.
    const accessoryHeadNoun =
      !fitmentFilters.categoryName &&
      inquiryFrame?.partType &&
      (guardedSearchIntent?.partKind === "universal" ||
        input.imageClassification?.partKind === "universal" ||
        isAccessoryOrChemicalIntent(
          [inquiryFrame.partType, consolidatedQuery, processText].filter(Boolean).join(" "),
        ))
        ? inquiryFrame.partType
        : null;

    // Fitment-part precision anchor: the customer named a SPECIFIC part this turn
    // that resolved to NO category (e.g. "เทอร์โมสตรัท" — no such category/product).
    // Without an anchor the search drifts to model-only and lists unrelated parts
    // of that car. Pass the part word so the bridge requires it (and returns
    // "no direct match" instead of drifting). Gated on a customer-typed specific
    // part with no category + not an accessory; generic catch-alls ("อะไหล่แอร์…"
    // from image OCR) are excluded so they still search broadly.
    const unresolvedFitmentPartHeadNoun =
      !fitmentFilters.categoryName &&
      !accessoryHeadNoun &&
      guardedSearchIntent?.partType &&
      !guardedSearchIntent.partType.includes("อะไหล่")
        ? guardedSearchIntent.partType
        : null;

    // A resolved product code drives a direct exact-code lookup and bypasses the
    // gate / low-confidence guard (the code itself is the confirmation). It never
    // overrides a genuinely non-product turn (greeting/payment) — those are already
    // excluded from codeCandidates via hardGuard / payment-slip above.
    const productSearch =
      isNonProductTurn || (!directProductCode && (classifierUncertain || gateBlocksSearch || imageOnlyLowConfidence))
      ? ({
          searched: false,
          reason: imageOnlyLowConfidence
            ? "IMAGE_LOW_CONFIDENCE"
            : classifierUncertain
              ? "CLASSIFIER_UNCERTAIN"
            : gateBlocksSearch
              ? `GATE_ASK:${gateDecision?.reason ?? ""}`
              : "NON_PRODUCT_TURN",
          query: null,
          result: null,
        } as Awaited<ReturnType<typeof searchChatProductInquiry>>)
      : directProductCode
        ? await dependencies.searchChatProductInquiry({
            // Exact-code lookup: the code identifies the item, so no fitment hard
            // filters (which could exclude a code that fits a different car) and no
            // free-text/hints noise — buildSearchQuery lets extractedPartNumber win.
            route: groupToRoute("product") ?? route,
            text: null,
            extractedPartNumber: directProductCode,
            extractedImageHints: null,
            contextHints: [],
            fitmentHints: null,
            accessoryHeadNoun: null,
          })
        : await dependencies.searchChatProductInquiry({
          route,
          text: consolidatedQuery ?? input.text,
          extractedImageHints: trustedImageSearchHints.length > 0 ? trustedImageSearchHints : null,
          contextHints,
          fitmentHints: {
            categoryName: fitmentFilters.categoryName ?? null,
            carBrandName: fitmentFilters.carBrandName ?? null,
            carModelName: fitmentFilters.carModelName ?? null,
            fitmentYear: frameYear,
          },
          accessoryHeadNoun,
          fitmentPartHeadNoun: unresolvedFitmentPartHeadNoun,
        });

    if (directProductCode && productSearch.searched) {
      fireAndForgetAudit(dependencies, {
        conversationId: input.conversation.id,
        action: "PRODUCT_CODE_DIRECT",
        payload: {
          lineEventId: input.lineEventId,
          code: directProductCode,
          source: extractChatRequiredSearchTokens(processText).includes(directProductCode)
            ? "text"
            : "image",
          total: productSearch.result?.total ?? 0,
        },
      });
    }

    if (isNonProductTurn) {
      fireAndForgetAudit(dependencies, {
        conversationId: input.conversation.id,
        action: "SEARCH_SKIPPED_NON_PRODUCT",
        payload: { lineEventId: input.lineEventId, latestText: input.text },
      });
    }

    if (consolidatedQuery) {
      fireAndForgetAudit(dependencies, {
        conversationId: input.conversation.id,
        action: "SEARCH_QUERY_CONSOLIDATED",
        payload: {
          lineEventId: input.lineEventId,
          latestText: input.text,
          consolidatedQuery,
          categoryName: fitmentFilters.categoryName ?? null,
          carBrandName: fitmentFilters.carBrandName ?? null,
          carModelName: fitmentFilters.carModelName ?? null,
          fitmentYear: guardedSearchIntent?.year ?? null,
          forceLiteralQuery: guardedSearch.forceLiteralQuery,
          requiredTokens: guardedSearch.requiredTokens,
        },
      });
    }

    fireAndForgetAudit(dependencies, {
      conversationId: input.conversation.id,
      action: "PRODUCT_SEARCH_SUMMARY",
      payload: productSearch.searched
        ? {
            lineEventId: input.lineEventId,
            searched: true,
            query: productSearch.query,
            total: productSearch.result.total,
            returnedCount: productSearch.result.ids.length,
            needsMoreInfo: productSearch.needsMoreInfo,
            droppedImageCodes: productSearch.droppedImageCodes,
          }
        : {
            lineEventId: input.lineEventId,
            searched: false,
            reason: productSearch.reason,
          },
    });

    // Live mode = AI is allowed to auto-send. Forced hand-offs below only act in
    // live mode (dry-run / AI-off never auto-send).
    const liveMode = autoReplyEnabled && !dryRun;

    // Escalation: search came back empty (product=0) for N consecutive turns.
    const failedSearchCount =
      productSearch.searched && productSearch.result.total === 0
        ? await (dependencies.countConsecutiveFailedLineSearches ?? countConsecutiveFailedLineSearches)(
            input.conversation.id,
          ).catch(() => 0)
        : 0;
    const shouldEscalateNoResults = failedSearchCount >= MAX_FAILED_SEARCHES_BEFORE_HANDOFF;
    const directNoMatchHandoff =
      liveMode &&
      productSearch.searched &&
      productSearch.result.total === 0 &&
      (Boolean(
        inquiryFrame?.partType &&
          (inquiryFrame.carBrand || inquiryFrame.carModel || guardedSearch.requiredTokens.length > 0),
      ) ||
        // The customer named a SPECIFIC part that anchored to zero matches (the
        // fitment-part precision anchor). Hand off even when no car was given —
        // the part word alone is a concrete, actionable request the shop lacks.
        productSearch.reason === "SEARCHED_FITMENT_PART_NO_MATCH");

    // Pull real catalog names for matched ids so the reply can show the customer
    // what was actually found (with a "verify before ordering" caveat) instead of
    // gatekeeping on chassis/OEM numbers they usually can't provide.
    const priceTier = await (dependencies.resolveLinePriceTier ?? resolveLinePriceTier)(
      input.lineUserId,
    ).catch(() => "UNKNOWN" as const);
    if (priceTier === "UNKNOWN") {
      fireAndForgetAudit(dependencies, {
        conversationId: input.conversation.id,
        action: "PRICE_TIER_RESOLVE_FAILED",
        payload: { lineEventId: input.lineEventId, path: "single" },
      });
    }
    const products = applyChatPriceTier(
      productSearch.searched && productSearch.result.ids.length > 0
        ? await dependencies.getChatProductSummaries(productSearch.result.ids).catch(() => [])
        : [],
      priceTier,
    );

    // The search matched rows (total > 0) but NONE are showable — every id was
    // filtered out by getChatProductSummaries (product turned inactive / hidden
    // from the storefront, or the summary fetch failed). Without this guard the
    // turn would send a "possible match" reply with an empty card list and notify
    // nobody (a silent dead-end): total>0 dodges the empty-search escalation, and
    // products.length===0 dodges the product-reply path. Treat it as a hand-off so
    // a human picks it up.
    const matchedButNoneShowable =
      liveMode &&
      productSearch.searched &&
      productSearch.result.total > 0 &&
      products.length === 0;

    // Option A — vehicle-unresolved guard. The customer named a car model THIS turn
    // (evidence-grounded, so it's real — not a hallucination) but it never became a
    // resolved hard fitment filter (carModelName/carBrandName both null). Any rows
    // returned are therefore NOT vehicle-scoped, so showing them would present other
    // vehicles' parts as if they fit the customer's car — the exact
    // "สายแอร์…สตาด้า2500 → D-Max/Revo/Colorado" mismatch. When there ARE rows to
    // suppress (products.length > 0), hand off + ask the customer to confirm the
    // vehicle instead of sending confident-but-wrong matches ("ไม่มั่นใจส่งแอดมิน").
    // NOT triggered on a resolved brand-only scope (that is an acceptable filter),
    // nor when total === 0 (the no-match handoffs below already cover that).
    const vehicleUnresolvedGuard =
      liveMode &&
      productSearch.searched &&
      products.length > 0 &&
      Boolean(guardedSearchIntent?.carModel) &&
      !fitmentFilters.carModelName &&
      !fitmentFilters.carBrandName;

    // Relevance gate — the search resolved NO category (categoryName=null), so no
    // hard filter kept results on-topic. Decide whether the rows are trustworthy
    // enough to show, or whether we hand off ("ไม่มั่นใจอย่าตอบมั่ว"). Three lanes:
    //   1. Accessory/universal intent (junk-drawer "อะไหล่อื่นๆ"): the bridge's
    //      head-noun anchor already tells us if the results stayed on the head noun
    //      (ANCHORED → show) or drifted after dropping it (FALLBACK → hand off).
    //   2. Fitment part: show when ANY shown row matched strongly on the product's
    //      own text — code/oem/name/keyword/fitment — regardless of category, which
    //      covers real "อะไหล่อื่นๆ" items the shop actually stocks.
    //   3. Exception: the customer gave BOTH a part word and a car, and a shown row
    //      is a genuinely-close trigram near-match (>= strong threshold) — allow it.
    // Anything else with a category-less result set is too weak to show → hand off.
    const STRONG_MATCH_REASONS = new Set(["code", "oem", "name", "keyword", "fitment"]);
    const categoryUnresolved = !fitmentFilters.categoryName;
    const shownMatchReasons = productSearch.searched
      ? products.map((p) => productSearch.result.matchReasons?.[p.id] ?? [])
      : [];
    const hasStrongShownMatch = shownMatchReasons.some((reasons) =>
      reasons.some((r) => STRONG_MATCH_REASONS.has(r)),
    );
    const highTrigramIds = new Set(
      productSearch.searched ? productSearch.result.highTrigramProductIds ?? [] : [],
    );
    const partAndCarProvided = Boolean(
      inquiryFrame?.partType && (inquiryFrame?.carBrand || inquiryFrame?.carModel),
    );
    const hasCloseTrigramShown = products.some((p) => highTrigramIds.has(p.id));
    const trigramExceptionShow = partAndCarProvided && hasCloseTrigramShown;
    const isAccessoryAnchored = productSearch.reason === "SEARCHED_ACCESSORY_HEAD_ANCHORED";
    const isAccessoryFallback = productSearch.reason === "SEARCHED_ACCESSORY_HEAD_FALLBACK";
    const weakCategoryMatchGuard =
      liveMode &&
      productSearch.searched &&
      products.length > 0 &&
      categoryUnresolved &&
      !vehicleUnresolvedGuard &&
      !isAccessoryAnchored &&
      (isAccessoryFallback || (!hasStrongShownMatch && !trigramExceptionShow));

    // ลูกค้าถามราคา/ขอส่วนลด → ส่งเรื่องให้แอดมินแจ้ง/ยืนยันราคา "ทุกกรณี" (ทุกประเภทลูกค้า)
    // ใช้ regex ราคา/ส่วนลด + intent ต่อราคา เป็นตัวจับ — ตั้งใจไม่รวม PURCHASE_INTENT
    // ล้วน ("เอาตัวนี้/สั่งเลย") ซึ่งเป็นการตัดสินใจซื้อ ไม่ใช่การถามราคา
    //  - hiddenPriceWithProducts: ข้อความนี้ระบุชื่อสินค้าเอง (guardedSearchIntent มี part/car) + เจอสินค้า
    //    → โชว์การ์ดก่อน แล้วต่อ note ส่งเรื่องราคา + freeze (ลูกค้าอยากเห็นว่ามีของ เช่น "คอยเย็นวีโก้ เท่าไร")
    //  - hiddenPriceDirect: ถามราคาล้วน ไม่ได้ระบุสินค้าในข้อความ (เช่น "ราคาเท่าไร" ต่อจากที่โชว์ไปแล้ว)
    //    → ส่งแอดมินตรง ไม่โชว์การ์ดซ้ำ
    const priceAskThisTurn =
      route.intent === LineIntent.PRICE_NEGOTIATION || PRICE_QUESTION_RE.test(input.text ?? "");
    const hiddenPriceInquiry = liveMode && priceAskThisTurn;
    // guardedSearchIntent = evidence-gated intent ของ "ข้อความเทิร์นนี้" (เฉพาะสิ่งที่ลูกค้าพิมพ์จริง
    // ไม่รวม history) → ใช้แยกว่าลูกค้าเปิดสินค้าใหม่ในข้อความนี้ หรือถามราคาล้วน
    const currentTurnNamedProduct = Boolean(
      guardedSearchIntent?.partType || guardedSearchIntent?.carModel || guardedSearchIntent?.carBrand,
    );
    const hiddenPriceWithProducts =
      hiddenPriceInquiry && currentTurnNamedProduct && productSearch.searched && products.length > 0;
    const hiddenPriceDirect = hiddenPriceInquiry && !hiddenPriceWithProducts;

    const postSearchDeliveryFallback =
      liveMode &&
      productSearch.searched &&
      products.length > 0 &&
      !isConversationAdminOwned(input.conversation.aiStatus) &&
      shouldUsePostSearchDeliveryFallback(config);

    // (#2) Kick the reply generation off NOW, in parallel with the purchase-intent
    // classification below — neither depends on the other, so this removes one
    // sequential Gemini call from the critical path on the slow product-match
    // turns. If a forced response (purchase / escalate / FAQ / shop info) ends up
    // winning, this result is simply discarded.
    const generateSuggestion = dependencies.generateChatSuggestion ?? generateChatSuggestion;
    const wantEarlyGenerate =
      liveMode &&
      !directNoMatchHandoff &&
      !postSearchDeliveryFallback &&
      (route.intent === LineIntent.PRODUCT_INQUIRY_TEXT ||
        route.intent === LineIntent.PART_IMAGE_INQUIRY ||
        route.intent === LineIntent.GREETING);

    // Admin has taken over (paused / waiting-admin / closed) → the bot stays
    // silent, so skip auto-send below. (Typing dots are fired at ingest time, in
    // ingestLineEvent, which runs for every webhook-driven turn.)
    const conversationBlocked = isConversationAdminOwned(input.conversation.aiStatus);

    const earlyGeneratePromise = wantEarlyGenerate
      ? generateSuggestion({
          intent: route.intent,
          originalText: input.text,
          productSearch,
          history,
          products,
        }).catch(() => null)
      : null;

    // Purchase intent → a human closes the sale. Keyword router first; then a
    // Gemini fallback only when the customer is plausibly deciding (product
    // inquiry with matches already shown), to keep the extra call rare.
    const isKeywordPurchase = route.intent === LineIntent.PURCHASE_INTENT;
    let isPurchaseIntent = isKeywordPurchase;
    if (
      !isPurchaseIntent &&
      liveMode &&
      !postSearchDeliveryFallback &&
      products.length > 0 &&
      // A price *inquiry* re-routed to product (e.g. "หม้อน้ำ d-max ราคาเท่าไหร่")
      // is NOT a purchase commitment — show the matches, don't hand off. Genuine
      // "เอาตัวนี้/สั่งเลย" classifies as group=purchase and never reaches here.
      !(regexPriceIntent && group === "product") &&
      (route.intent === LineIntent.PRODUCT_INQUIRY_TEXT ||
        route.intent === LineIntent.PART_IMAGE_INQUIRY)
    ) {
      isPurchaseIntent = await (dependencies.classifyPurchaseIntent ?? classifyPurchaseIntent)(input.text).catch(
        () => false,
      );
    }
    // ลูกค้าซ่อนราคาถามราคาสินค้าใหม่ → ต้องโชว์การ์ดก่อนแล้วค่อยส่งแอดมิน (ไม่ใช่ purchase handoff ที่ข้ามการ์ด)
    // ปลด purchase-intent เพื่อให้ไหลเข้าเส้นทางตอบสินค้าปกติ แล้ว handoffAfterSend จัดการ freeze/notify
    if (hiddenPriceWithProducts) {
      isPurchaseIntent = false;
    }

    // FAQ grounding (จูน's voice, never fabricated). Try a grounded answer when:
    //  - a product search came back empty (the "question" may be shipping/warranty/
    //    how-to-order, not a part), OR
    //  - it's a NON-product turn that the keyword router didn't already route to the
    //    canned SHOP_INFO answer (e.g. "ร้านคุณอยู่ไหน" phrased so the regex misses).
    // This lets the AI actually ANSWER a general/shop question instead of punting it
    // to an admin.
    // A part image whose vision OCR succeeded (kind=part_image, not low-confidence)
    // that comes back with zero matches is a genuine "we don't stock this", NOT a
    // shipping/how-to-order question — so it must skip the FAQ branch (which would
    // answer with the generic "send a photo of the part" reply, absurd right after
    // the customer sent one) and instead acknowledge the part + hand off to a human.
    const partImageNoMatch =
      liveMode &&
      input.imageClassification?.kind === "part_image" &&
      input.imageClassification.confidence !== "LOW" &&
      productSearch.searched &&
      productSearch.result.total === 0;

    // A product turn whose subject is anchored (the frame already has a part type)
    // but the search found nothing is a genuine "we don't stock this" — NOT a
    // shipping/how-to-order question. Routing it through the FAQ would let the LLM
    // answer a policy-style reply and silently close the turn (no admin notified),
    // so it must skip FAQ and fall through to the escalation / ask path instead.
    const anchoredProductNoMatch = Boolean(!isNonProductTurn && inquiryFrame?.partType);
    const faqAnswer =
      liveMode &&
      // A purchase-commitment turn ("เอาตัวนี้ / เอาตัว 900 / 1 อัน") is classified as
      // a non-product turn, which would otherwise match the FAQ gate below and let an
      // LLM answer it with a generic "ขอทราบรุ่นรถ" ask — pre-empting the purchase
      // hand-off. Skip FAQ entirely for purchase turns (also avoids a wasted call).
      !isPurchaseIntent &&
      (tryFaqThenAsk ||
        (isNonProductTurn && route.intent !== LineIntent.SHOP_INFO) ||
        (productSearch.searched &&
          productSearch.result.total === 0 &&
          !partImageNoMatch &&
          !directNoMatchHandoff &&
          !anchoredProductNoMatch))
        ? await (dependencies.answerFromChatFaq ?? answerFromChatFaq)({ text: input.text }).catch(() => ({
            answered: false,
            reply: "",
          }))
        : { answered: false, reply: "" };

    // A forced response replaces the normal AI reply with a deterministic message.
    // `handoff: true` also routes the conversation to a human (escalation / purchase
    // intent); `handoff: false` is an auto-answer that keeps the AI active (shop info).
    const forcedResponse:
      | {
          message: string;
          reason: string;
          handoff: boolean;
          audit?: string;
          auditPayload?: Record<string, string | number | null>;
        }
      | null =
      // Lone image with low-confidence OCR — ask for confirmation instead of
      // guessing ("ห้ามเดา"). Never a hand-off; the AI stays active.
      liveMode && imageOnlyLowConfidence
        ? {
            message: CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY,
            reason: "IMAGE_LOW_CONFIDENCE_HANDOFF",
            handoff: true,
            audit: "AI_UNCERTAIN_PRODUCT_HANDOFF",
            auditPayload: { lineEventId: input.lineEventId, confidence: "LOW" },
          }
      // Never a hand-off — the AI stays active and waits for the answer.
      : liveMode && classifierUncertain
        ? {
            message: CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY,
            reason: "CLASSIFIER_UNCERTAIN_HANDOFF",
            handoff: true,
            audit: "AI_UNCERTAIN_PRODUCT_HANDOFF",
            auditPayload: { lineEventId: input.lineEventId, reason: "CLASSIFIER_UNCERTAIN" },
          }
      : liveMode && gateBlocksSearch && gateDecision?.reason === "BROAD_PART_TYPE"
        ? {
            message: CHAT_UNCERTAIN_PRODUCT_HANDOFF_REPLY,
            reason: "BROAD_PART_TYPE_HANDOFF",
            handoff: true,
            audit: "AI_UNCERTAIN_PRODUCT_HANDOFF",
            auditPayload: { lineEventId: input.lineEventId, reason: gateDecision.reason },
          }
      : liveMode && gateBlocksSearch && gateDecision?.action === "ask"
        ? {
            message: buildChatSearchAskReply(gateDecision.ask),
            reason: `GATE_ASK_${gateDecision.ask}`,
            handoff: false,
            audit: "AI_SEARCH_GATE_ASK",
            auditPayload: { lineEventId: input.lineEventId, ask: gateDecision.ask, reason: gateDecision.reason },
          }
        : matchedButNoneShowable
        ? {
            message: NO_RESULTS_ESCALATION_MESSAGE,
            reason: "MATCHED_BUT_NONE_SHOWABLE",
            handoff: true,
            audit: "AI_MATCHED_BUT_NONE_SHOWABLE",
            auditPayload: {
              lineEventId: input.lineEventId,
              total: productSearch.searched ? productSearch.result.total : 0,
            },
          }
        // Option A — customer named a car we couldn't lock to a fitment filter, and
        // the results aren't vehicle-scoped → confirm the vehicle instead of showing
        // other models' parts.
        : vehicleUnresolvedGuard
        ? {
            message: CHAT_VEHICLE_UNRESOLVED_HANDOFF_REPLY,
            reason: "VEHICLE_UNRESOLVED_HANDOFF",
            handoff: true,
            audit: "AI_VEHICLE_UNRESOLVED_HANDOFF",
            auditPayload: {
              lineEventId: input.lineEventId,
              carModel: guardedSearchIntent?.carModel ?? null,
              total: productSearch.searched ? productSearch.result.total : 0,
            },
          }
        // Relevance gate — category-less results too weakly linked to the query
        // (no strong match, no close trigram near-match, or an accessory search
        // that drifted off its head noun). Hand off instead of showing wrong parts.
        : weakCategoryMatchGuard
        ? {
            message: CHAT_WEAK_MATCH_HANDOFF_REPLY,
            reason: "WEAK_CATEGORY_MATCH_HANDOFF",
            handoff: true,
            audit: "AI_WEAK_CATEGORY_MATCH_HANDOFF",
            auditPayload: {
              lineEventId: input.lineEventId,
              searchReason: productSearch.searched ? productSearch.reason : null,
              accessoryFallback: isAccessoryFallback ? "yes" : "no",
              total: productSearch.searched ? productSearch.result.total : 0,
            },
          }
        : liveMode && partImageNoMatch
        ? {
            message: buildJunePartImageNoMatchReply(
              inquiryFrame
                ? {
                    partType: inquiryFrame.partType,
                    carBrand: inquiryFrame.carBrand,
                    carModel: inquiryFrame.carModel,
                    year: frameYear,
                  }
                : {
                    partType: input.imageClassification?.partType ?? null,
                    carBrand: input.imageClassification?.carBrand ?? null,
                    carModel: input.imageClassification?.carModel ?? null,
                    year: input.imageClassification?.year ?? null,
                  },
            ),
            reason: "PART_IMAGE_NO_MATCH",
            handoff: true,
            audit: "AI_PART_IMAGE_NO_MATCH",
            auditPayload: {
              lineEventId: input.lineEventId,
              partType: inquiryFrame?.partType ?? input.imageClassification?.partType ?? null,
            },
          }
        : liveMode && directNoMatchHandoff
        ? {
            // Part-aware acknowledgement ("สำหรับ<part> <car> ปี <ปี>…") instead of
            // the generic line, so the customer sees we understood the exact request
            // before the human hand-off. Falls back to the part word alone when no
            // car was captured.
            message: buildJuneTextNoMatchHandoffReply(
              inquiryFrame
                ? {
                    partType: inquiryFrame.partType ?? unresolvedFitmentPartHeadNoun,
                    carBrand: inquiryFrame.carBrand,
                    carModel: inquiryFrame.carModel,
                    year: frameYear,
                  }
                : { partType: unresolvedFitmentPartHeadNoun, carBrand: null, carModel: null, year: null },
            ),
            reason: "DIRECT_NO_MATCH_HANDOFF",
            handoff: true,
            audit: "AI_DIRECT_NO_MATCH_HANDOFF",
            auditPayload: {
              lineEventId: input.lineEventId,
              partType: inquiryFrame?.partType ?? unresolvedFitmentPartHeadNoun ?? null,
              carBrand: inquiryFrame?.carBrand ?? null,
              carModel: inquiryFrame?.carModel ?? null,
              failedSearchCount,
            },
          }
        // ลูกค้าซ่อนราคาถามราคาสินค้าเดิม/ล้วน → ส่งแอดมินตรง ไม่โชว์การ์ดซ้ำ (freeze + notify)
        : liveMode && route.reason === "SERVICE_INQUIRY_KEYWORD"
        ? {
            message: SERVICE_HANDOFF_MESSAGE,
            reason: "SERVICE_INQUIRY_HANDOFF",
            handoff: true,
            audit: "AI_SERVICE_HANDOFF",
            auditPayload: { lineEventId: input.lineEventId },
          }
        : hiddenPriceDirect
        ? {
            message: PRICE_HIDDEN_HANDOFF_MESSAGE,
            reason: "PRICE_HIDDEN_HANDOFF",
            handoff: true,
            audit: "AI_PRICE_HIDDEN_HANDOFF",
            auditPayload: { lineEventId: input.lineEventId },
          }
        // Escalation MUST win over a FAQ auto-answer: after N empty searches the
        // customer needs a human, and an LLM FAQ reply (which decides its own
        // `answered`) could otherwise gloss over it and keep the room AI-owned with
        // nobody notified.
        : liveMode && shouldEscalateNoResults
          ? {
              message: NO_RESULTS_ESCALATION_MESSAGE,
              reason: `ESCALATE_NO_RESULTS_x${failedSearchCount}`,
              handoff: true,
              audit: "AI_ESCALATE_NO_RESULTS",
              auditPayload: { lineEventId: input.lineEventId, failedSearchCount },
            }
        // Purchase intent MUST win over a FAQ auto-answer: once the customer commits
        // to buy ("เอาตัวนี้ / เอาตัว 900 / 1 อัน") they are closing the sale, so an
        // LLM FAQ reply (which decides its own `answered`) must never gloss over it
        // with a generic "ขอทราบรุ่นรถ" ask and keep the room AI-owned with nobody
        // notified. (Belt-and-suspenders: `faqAnswer` is also gated off for purchase
        // turns above, so it should already be `answered: false` here.)
        : liveMode && isPurchaseIntent
          ? {
              message: PURCHASE_HANDOFF_MESSAGE,
              reason: "PURCHASE_INTENT",
              handoff: true,
              audit: "AI_PURCHASE_HANDOFF",
              auditPayload: { lineEventId: input.lineEventId, source: isKeywordPurchase ? "keyword" : "ai" },
            }
          : faqAnswer.answered
          ? { message: faqAnswer.reply, reason: "FAQ", handoff: false }
          : liveMode && route.intent === LineIntent.SHOP_INFO
            ? { message: SHOP_INFO_MESSAGE, reason: "SHOP_INFO", handoff: false }
            : liveMode && tryFaqThenAsk
              ? {
                  // general_faq / other that the FAQ couldn't answer → ask the
                  // customer for details in จูน's voice (keep the conversation
                  // moving), never a silent admin hand-off.
                  message: buildJuneAskDetailsReply(),
                  reason: "OTHER_ASK_DETAILS",
                  handoff: false,
                }
              : null;

    let suggestion: {
      suggestedReply: string;
      confidence: LineAiConfidence;
      reasoningSummary: string;
      matchedProducts?: unknown;
    };
    let postSearchDeliveryFallbackAuditPayload: Record<string, string | number | null> | null = null;

    if (forcedResponse) {
      suggestion = {
        suggestedReply: forcedResponse.message,
        confidence: forcedResponse.handoff ? LineAiConfidence.ADMIN_REQUIRED : LineAiConfidence.POSSIBLE_MATCH,
        reasoningSummary: forcedResponse.reason,
        matchedProducts: null,
      };
    } else if (postSearchDeliveryFallback) {
      suggestion = {
        suggestedReply: buildJuneDeadlineReply({
          query: consolidatedQuery ?? input.text,
          products,
          known: inquiryFrame
            ? {
                partType: inquiryFrame.partType,
                carBrand: inquiryFrame.carBrand,
                carModel: inquiryFrame.carModel,
                year: frameYear,
              }
            : null,
        }),
        confidence: LineAiConfidence.POSSIBLE_MATCH,
        reasoningSummary: "POST_SEARCH_DELIVERY_FALLBACK",
        matchedProducts: productSearch.searched ? productSearch.result : null,
      };
      postSearchDeliveryFallbackAuditPayload = {
        lineEventId: input.lineEventId,
        reason: "AFTER_SEARCH_SERVERLESS_BUDGET",
        remainingMs: webhookRemainingMs(config),
        productCount: products.length,
      };
    } else {
      // (#3) Deadline guard: the reply must land inside the FREE reply-token
      // window (≈45s), so we race the Gemini reply against the remaining budget.
      // If it doesn't return in time (a hung key, etc.), fall back to a จูน-voiced
      // deterministic reply that still presents the SAME matched products/cards —
      // only the prose is templated — so we never miss the token (→ no paid push).
      const genPromise =
        earlyGeneratePromise ??
        generateSuggestion({
          intent: route.intent,
          originalText: input.text,
          productSearch,
          history,
          products,
        }).catch(() => null);

      const tokenBudgetMs = config.replyTokenMaxAgeMs ?? 45_000;
      const elapsedMs = config.receivedAt
        ? Date.now() - config.receivedAt.getTime()
        : Date.now() - pipelineStartedAtMs;
      const remainingMs = tokenBudgetMs - elapsedMs - REPLY_DEADLINE_MARGIN_MS;

      const DEADLINE = Symbol("deadline");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const raced =
        remainingMs <= 0
          ? DEADLINE
          : await Promise.race([
              genPromise,
              new Promise<typeof DEADLINE>((resolve) => {
                timer = setTimeout(() => resolve(DEADLINE), remainingMs);
              }),
            ]);
      if (timer) clearTimeout(timer);

      if (raced && raced !== DEADLINE) {
        suggestion = raced;
      } else {
        suggestion = {
          suggestedReply: buildJuneDeadlineReply({
            query: consolidatedQuery ?? input.text,
            products,
            // Frame-aware: ask only for slots still missing, never re-ask the
            // part/car/year we already know (e.g. when an image's OCR code was
            // unclear but the part + car + year are already established).
            known: inquiryFrame
              ? {
                  partType: inquiryFrame.partType,
                  carBrand: inquiryFrame.carBrand,
                  carModel: inquiryFrame.carModel,
                  year: frameYear,
                }
              : null,
          }),
          confidence: products.length > 0 ? LineAiConfidence.POSSIBLE_MATCH : LineAiConfidence.NEED_MORE_INFO,
          reasoningSummary: raced === DEADLINE ? "DEADLINE_FALLBACK" : "GENERATE_FAILED_FALLBACK",
          matchedProducts: productSearch.searched ? productSearch.result : null,
        };
        fireAndForgetAudit(dependencies, {
          conversationId: input.conversation.id,
          action: "AI_DEADLINE_FALLBACK",
          payload: {
            lineEventId: input.lineEventId,
            reason: raced === DEADLINE ? "DEADLINE" : "GENERATE_FAILED",
            remainingMs,
            productCount: products.length,
          },
        });
      }
    }

    const hasReplyToken = canUseReplyToken(config, input.canReply);
    let sendDecision = resolveLineAiSendDecision({
      autoReplyEnabled,
      dryRun,
      conversationStatus: input.conversation.aiStatus,
      route,
      confidence: suggestion.confidence,
      hasReplyToken,
      allowPushFallback: config.allowPushFallback ?? false,
    });

    // Never auto-send (even a template/FAQ answer) once an admin has taken over the
    // conversation (paused / waiting-admin / closed) — the human is handling it.
    // (conversationBlocked is hoisted above, near the loading-animation gate.)

    // Force-deliver the forced-response message (a handoff's ADMIN_REQUIRED
    // confidence would otherwise resolve to a silent handoff). Falls back to a
    // silent handoff only when there is no usable delivery channel. Suppressed
    // when the conversation is admin-owned (above).
    if (forcedResponse && !conversationBlocked) {
      const deliveryMode = hasReplyToken
        ? LineDeliveryMode.REPLY
        : config.allowPushFallback
          ? LineDeliveryMode.PUSH
          : LineDeliveryMode.NONE;
      sendDecision =
        deliveryMode === LineDeliveryMode.NONE
          ? { action: "handoff", deliveryMode, reason: forcedResponse.reason }
          : { action: "send", deliveryMode, reason: forcedResponse.reason };
    }

    // Normal admin hand-off (payment, address, status, price, claim, unknown, low
    // confidence): acknowledge the customer politely first so the AI never goes
    // silent, then still hand off to a human. (action === "handoff" already implies
    // live mode; a conversation that's already waiting resolves to store_only.)
    let handoffAfterSend = false;
    if (!forcedResponse && sendDecision.action === "handoff") {
      const deliveryMode = hasReplyToken
        ? LineDeliveryMode.REPLY
        : config.allowPushFallback
          ? LineDeliveryMode.PUSH
          : LineDeliveryMode.NONE;
      if (deliveryMode !== LineDeliveryMode.NONE) {
        suggestion = { ...suggestion, suggestedReply: handoffAckForIntent(route.intent) };
        sendDecision = { action: "send", deliveryMode, reason: `HANDOFF_ACK_${sendDecision.reason}` };
        handoffAfterSend = true;
      }
    }

    // ลูกค้าซ่อนราคา + เปิดสินค้าใหม่ + ถามราคา → ตอบสินค้า/การ์ดตามปกติ ("สอบถามราคา") แล้วต่อท้าย
    // note ส่งเรื่องราคา + freeze WAITING_ADMIN + แจ้งแอดมิน (freeze/notify จัดการที่ท้ายฟังก์ชัน)
    if (!forcedResponse && hiddenPriceWithProducts && sendDecision.action === "send") {
      handoffAfterSend = true;
    }

    await dependencies.storeLineAiSuggestion({
      conversationId: input.conversation.id,
      lineMessageId: input.inboundMessage.id,
      intent: route.intent,
      suggestedReply: suggestion.suggestedReply,
      confidence: suggestion.confidence,
      matchedProducts: suggestion.matchedProducts ? JSON.parse(JSON.stringify(suggestion.matchedProducts)) : null,
      reasoningSummary: suggestion.reasoningSummary,
      status: sendDecision.action === "send" ? LineAiSuggestionStatus.SENT : LineAiSuggestionStatus.DRAFT,
      deliveryMode: sendDecision.deliveryMode,
      sentAt: sendDecision.action === "send" ? new Date() : null,
    });

    fireAndForgetAudit(dependencies, {
      conversationId: input.conversation.id,
      action: "AI_SEND_DECISION",
      payload: {
        lineEventId: input.lineEventId,
        action: sendDecision.action,
        deliveryMode: sendDecision.deliveryMode,
        reason: sendDecision.reason,
        pipelineDurationMs: Date.now() - pipelineStartedAtMs,
      },
    });

    // Product cards (Flex) shown alongside the text reply so the customer can tap
    // through to the real storefront pages. Skipped on a forced hand-off (we just
    // send the bridging message). Null when no matches or no base URL.
    const placeholderImageUrl =
      !forcedResponse && products.length > 0 ? await resolveFlexPlaceholderImageUrl().catch(() => null) : null;
    const productFlex = forcedResponse
      ? null
      : buildProductFlexMessage({
          products,
          searchQuery: productSearch.searched ? productSearch.query : null,
          total: productSearch.searched ? productSearch.result.total : 0,
          placeholderImageUrl,
          // Mirror the fitment filters the LINE search ACTUALLY applied so the
          // "view all on web" link lands on the SAME set the customer saw. After a
          // did-you-mean retry the year is dropped, so we must use the search's
          // appliedFilters — not the original frame's year (which would re-add a
          // contradictory hard year-filter and zero out the web results).
          filters: productSearch.searched
            ? {
                categoryName: productSearch.appliedFilters.categoryName,
                carBrandName: productSearch.appliedFilters.carBrandName,
                carModelName: productSearch.appliedFilters.carModelName,
                year: productSearch.appliedFilters.fitmentYear,
              }
            : undefined,
        });
    // Persona follow-up: after showing the matches, nudge the customer for the
    // one missing detail (year for rule #1, part type for rule #2) so the next
    // turn can pin the exact fit. Sent as its own bubble AFTER the flex cards.
    // Only when we actually showed products (not a forced hand-off / ask).
    // Price inquiries that we answered with products get a "price → admin" note
    // (the shop sets prices, not the AI); it takes precedence over the year/part
    // nudge so we never stack two follow-up bubbles.
    // Transparency note for a "did you mean" recovery (the original query found
    // nothing; these are a best-guess spelling/synonym match with the year filter
    // dropped). Placed ABOVE the year/part nudge because it already re-asks for the
    // year when one was dropped — so we never double-ask. Price notes still win
    // (their hand-off flow is a separate concern).
    const didYouMeanNote =
      productSearch.searched && productSearch.didYouMean
        ? buildDidYouMeanNote(productSearch.didYouMean)
        : null;
    // Transparency note (audit item D): results came from the engine's broad OR
    // recall — every row matched only PART of the query (right car / wrong part,
    // or right part / wrong car). Tell the customer these are near-matches so a
    // half-match never reads as an exact hit. didYouMean already carries its own
    // note (a more specific recovery), so it wins when both apply.
    const usedBroadFallback = productSearch.searched && productSearch.result.usedBroadFallback === true;
    const followUpBubble =
      !forcedResponse && products.length > 0
        ? hiddenPriceWithProducts
          ? textMessage(PRICE_HIDDEN_HANDOFF_NOTE)
          : regexPriceIntent
            ? textMessage(PRICE_INQUIRY_DEFER_NOTE)
            : didYouMeanNote
              ? textMessage(didYouMeanNote)
              : usedBroadFallback
                ? textMessage(BROAD_FALLBACK_NEAR_MATCH_NOTE)
                : searchFollowUp
                  ? textMessage(buildChatSearchFollowUp(searchFollowUp))
                  : null
        : null;
    const outboundMessages = [
      textMessage(suggestion.suggestedReply),
      ...(productFlex ? [productFlex] : []),
      ...(followUpBubble ? [followUpBubble] : []),
    ];

    // Abort-on-newer (coalescing): a customer message arrived while we were
    // computing this reply. Discard the send and let the owner loop re-run with
    // the merged turn, so the customer only ever sees ONE reply built from the
    // latest data. Only relevant when an actual send was about to happen.
    if (sendDecision.action === "send" && input.shouldAbortBeforeSend) {
      const abort = await input.shouldAbortBeforeSend().catch(() => false);
      if (abort) {
        fireAndForgetAudit(dependencies, {
          conversationId: input.conversation.id,
          action: "AI_COALESCE_ABORTED",
          payload: { lineEventId: input.lineEventId, reason: sendDecision.reason },
        });
        await dependencies.updateLineAiJob(input.jobId, {
          status: LineAiJobStatus.COMPLETED,
          result: { action: "coalesce_aborted", replied: false },
          finishedAt: new Date(),
        });
        return { replied: false, aborted: COALESCE_ABORTED };
      }
    }

    let replied = false;
    if (
      sendDecision.action === "send" &&
      sendDecision.deliveryMode === LineDeliveryMode.REPLY &&
      input.replyToken &&
      config.channelAccessToken
    ) {
      const outboundMessage = await dependencies.appendLineMessage({
        conversationId: input.conversation.id,
        lineUserId: input.lineUserId,
        direction: LineMessageDirection.OUTBOUND_AI,
        messageType: input.messageType,
        intent: route.intent,
        text: suggestion.suggestedReply,
        deliveryMode: LineDeliveryMode.REPLY,
        deliveryStatus: LineDeliveryStatus.PENDING,
      });

      await dependencies.replyLineMessage({
        channelAccessToken: config.channelAccessToken,
        replyToken: input.replyToken,
        messages: outboundMessages,
      });

      await dependencies.markOutboundLineMessageSent({
        messageId: outboundMessage.id,
        deliveryMode: LineDeliveryMode.REPLY,
      });
      replied = true;
    }

    if (
      sendDecision.action === "send" &&
      sendDecision.deliveryMode === LineDeliveryMode.PUSH &&
      config.channelAccessToken
    ) {
      const outboundMessage = await dependencies.appendLineMessage({
        conversationId: input.conversation.id,
        lineUserId: input.lineUserId,
        direction: LineMessageDirection.OUTBOUND_AI,
        messageType: input.messageType,
        intent: route.intent,
        text: suggestion.suggestedReply,
        deliveryMode: LineDeliveryMode.PUSH,
        deliveryStatus: LineDeliveryStatus.PENDING,
      });

      await dependencies.pushLineMessages({
        channelAccessToken: config.channelAccessToken,
        recipientIds: [input.lineUserId],
        messages: outboundMessages,
      });

      await dependencies.markOutboundLineMessageSent({
        messageId: outboundMessage.id,
        deliveryMode: LineDeliveryMode.PUSH,
      });
      replied = true;
    }

    // Hand off + pause the AI on a forced hand-off (escalation / purchase intent —
    // which may have force-sent a bridging message) or a normal admin-required
    // handoff. A non-handoff forced response (e.g. shop info) keeps the AI active.
    if (forcedResponse?.handoff || handoffAfterSend || sendDecision.action === "handoff") {
      await dependencies.updateLineConversationState(
        input.conversation.id,
        buildLineConversationStatePatch({
          type: "waiting_admin",
          at: new Date(),
          reason: sendDecision.reason,
        }),
      );
    }

    if (forcedResponse?.audit) {
      fireAndForgetAudit(dependencies, {
        conversationId: input.conversation.id,
        action: forcedResponse.audit,
        payload: forcedResponse.auditPayload ?? {},
      });
    }
    if (
      postSearchDeliveryFallbackAuditPayload &&
      typeof dependencies.storeLineAiAudit === "function"
    ) {
      fireAndForgetAudit(dependencies, {
        conversationId: input.conversation.id,
        action: "AI_DEADLINE_FALLBACK",
        payload: postSearchDeliveryFallbackAuditPayload,
      });
    }

    // Notify admins whenever the AI did NOT auto-reply successfully, or on a forced
    // hand-off — i.e. the customer is now waiting for a human. Deduped per
    // conversation; never throws into the reply flow. (Shop-info auto-replies do
    // not notify.)
    if (forcedResponse?.handoff || handoffAfterSend || !(sendDecision.action === "send" && replied)) {
      const notify = dependencies.notifyLineOaNeedsAdmin ?? notifyLineOaNeedsAdmin;
      const countPending = dependencies.countPendingPaymentSlipsForConversation ?? countPendingPaymentSlipsForConversation;
      const pendingSlipCount = await countPending(input.conversation.id).catch(() => 0);
      await notify({
        conversationId: input.conversation.id,
        displayName: input.conversation.displayName,
        text: input.text,
        messageType: input.messageType,
        pendingSlipCount,
      }).catch((error) => {
        console.warn(
          "[line-webhook] admin handoff notification skipped/failed:",
          error instanceof Error ? error.message : "unknown",
        );
      });
    }

    await dependencies.updateLineAiJob(input.jobId, {
      status: LineAiJobStatus.COMPLETED,
      result: {
        action: sendDecision.action,
        deliveryMode: sendDecision.deliveryMode,
        replied,
      },
      finishedAt: new Date(),
    });

    return { replied };
  } catch (error) {
    // Layer-6 safety net: when the AI pipeline throws unexpectedly, the customer
    // must never go silent and admins must be alerted. Best-effort only — every
    // fallback step is wrapped so a failure here can never override the original
    // error or block the job-failed bookkeeping below.
    const FALLBACK_TEXT = "ขอส่งต่อให้แอดมินช่วยดูแลต่อนะคะ เดี๋ยวติดต่อกลับโดยเร็วที่สุดค่ะ 🙏";

    if (config.channelAccessToken) {
      try {
        if (canUseReplyToken(config, input.canReply) && input.replyToken) {
          await dependencies.replyLineMessage({
            channelAccessToken: config.channelAccessToken,
            replyToken: input.replyToken,
            messages: [textMessage(FALLBACK_TEXT)],
          });
        } else if (config.allowPushFallback) {
          await dependencies.pushLineMessages({
            channelAccessToken: config.channelAccessToken,
            recipientIds: [input.lineUserId],
            messages: [textMessage(FALLBACK_TEXT)],
          });
        }
      } catch (sendError) {
        console.warn(
          "[line-webhook-processor] fallback send failed:",
          sendError instanceof Error ? sendError.message : "unknown",
        );
      }
    }

    const notify = dependencies.notifyLineOaNeedsAdmin ?? notifyLineOaNeedsAdmin;
    const countPending = dependencies.countPendingPaymentSlipsForConversation ?? countPendingPaymentSlipsForConversation;
    const pendingSlipCount = await countPending(input.conversation.id).catch(() => 0);
    await notify({
      conversationId: input.conversation.id,
      displayName: input.conversation.displayName,
      text: input.text,
      messageType: input.messageType,
      pendingSlipCount,
    }).catch((notifyError) => {
      console.warn(
        "[line-webhook-processor] fallback admin notify failed:",
        notifyError instanceof Error ? notifyError.message : "unknown",
      );
    });

    await dependencies.updateLineAiJob(input.jobId, {
      status: LineAiJobStatus.FAILED,
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown LINE AI job failure",
      finishedAt: new Date(),
    });
    throw error;
  }
}

type NormalizedLineEvent = ReturnType<typeof normalizeLineWebhookEvents>[number];

/**
 * Persists one inbound event (route + image classify + slip ingest + message row
 * + PENDING job) WITHOUT generating a reply. Shared by the legacy per-event path
 * and the coalesced path so both stay byte-for-byte consistent on ingest.
 */
async function ingestLineEvent(
  event: NormalizedLineEvent,
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
  imageSearchEnabled: boolean,
): Promise<{
  conversation: Awaited<ReturnType<typeof getOrCreateLineConversation>>;
  inboundMessage: Awaited<ReturnType<typeof appendLineMessage>>;
  route: ReturnType<typeof routeChatIntent>;
  imageClassification: LineImageClassification | null;
  aiJob: Awaited<ReturnType<typeof storeLineAiJob>>;
}> {
  // Callers guard `!event.lineUserId` before invoking; re-narrow for type safety.
  const lineUserId = event.lineUserId;
  if (!lineUserId) {
    throw new Error("ingestLineEvent called without lineUserId");
  }
  const customerId = await dependencies.findActiveCustomerIdByLineUserId(lineUserId);
  const lineProfile = config.lineProfilesByUserId?.[lineUserId] ?? null;
  const conversation = await dependencies.getOrCreateLineConversation({
    lineUserId,
    customerId,
    displayName: lineProfile?.displayName ?? null,
    pictureUrl: lineProfile?.pictureUrl ?? null,
  });

  let route = routeChatIntent({ messageType: event.messageType, text: event.text });

  // Instant typing dots — fire here, the moment the message is ingested and
  // BEFORE the (slow) image vision call below, so the customer sees "กำลังพิมพ์"
  // right away even for photos. The conversation row above already gives us its
  // admin-owned status, so the gate stays intact. Skip stickers (greet-once /
  // silent) and silent text (menu command / noise like "...") that the bot never
  // answers — otherwise the dots would linger 60s with no reply. In live mode
  // every other message (text, part photo, payment slip) gets at least an ack
  // reply, which clears the dots. Best-effort & non-blocking (see helper).
  const isSilentText =
    event.messageType === LineMessageType.TEXT &&
    (isMenuCommand(event.text) || isNoiseText(event.text));
  if (event.messageType !== LineMessageType.STICKER && !isSilentText) {
    maybeStartLoadingDots(config, dependencies, { lineUserId, aiStatus: conversation.aiStatus });
  }

  let imageClassification: LineImageClassification | null = null;
  if (event.messageType === LineMessageType.IMAGE) {
    const classify = dependencies.classifyLineImage ?? classifyLineImage;
    imageClassification = await classify({
      channelAccessToken: config.channelAccessToken,
      lineMessageId: event.lineMessageId,
    });
    route = applyImageClassificationToRoute(route, imageClassification, imageSearchEnabled);

    fireAndForgetAudit(dependencies, {
      conversationId: conversation.id,
      action: "IMAGE_CLASSIFIED",
      payload: {
        lineEventId: event.lineEventId,
        kind: imageClassification.kind,
        intent: route.intent,
        confidence: imageClassification.confidence,
        searchHintCount: imageClassification.searchHints.length,
        reason: imageClassification.reason,
      },
    });

    if (imageClassification.kind === "payment_slip") {
      const ingestSlip = dependencies.ingestPaymentSlip ?? ingestPaymentSlip;
      const slip = await ingestSlip({
        channelAccessToken: config.channelAccessToken,
        conversationId: conversation.id,
        lineUserId,
        lineMessageId: event.lineMessageId,
        content: imageClassification.content ?? null,
        ocr: imageClassification.ocr ?? null,
      });

      fireAndForgetAudit(dependencies, {
        conversationId: conversation.id,
        action: "PAYMENT_SLIP_OCR",
        payload: {
          lineEventId: event.lineEventId,
          paymentSlipId: slip.slipId,
          verificationStatus: slip.verificationStatus,
          imageStored: slip.imageStored,
          hasAmount: slip.ocr.amount !== null,
          hasBank: slip.ocr.bank !== null,
          hasReference: slip.ocr.referenceNo !== null,
          hasTransferDatetime: slip.ocr.transferDatetimeIso !== null,
        },
      });
    }
  }

  const inboundMessage = await dependencies.appendLineMessage({
    conversationId: conversation.id,
    lineUserId,
    lineMessageId: event.lineMessageId,
    lineEventId: event.lineEventId,
    replyToken: event.replyToken,
    direction: LineMessageDirection.INBOUND,
    messageType: event.messageType,
    intent: route.intent,
    text: event.text,
    rawEvent: event.rawEvent,
  });

  // Mirror EVERY inbound customer message to Telegram (raw chat relay, not a
  // bell notification — see mirrorLineMessageToTelegram). Fire-and-forget so a
  // Telegram hiccup never delays or breaks the webhook reply pipeline.
  void mirrorLineMessageToTelegram({
    displayName: conversation.displayName,
    messageType: event.messageType,
    text: event.text,
    at: inboundMessage.createdAt,
  }).catch((error) => {
    console.warn(
      "[line-webhook-processor] telegram mirror failed",
      error instanceof Error ? error.message : "unknown",
    );
  });

  fireAndForgetAudit(dependencies, {
    conversationId: conversation.id,
    action: "INBOUND_EVENT_ACCEPTED",
    payload: {
      lineEventId: event.lineEventId,
      lineMessageId: event.lineMessageId,
      messageType: event.messageType,
      hasReplyToken: Boolean(event.replyToken),
    },
  });

  await dependencies.updateLineConversationState(
    conversation.id,
    buildLineConversationStatePatch({ type: "customer_message", at: inboundMessage.createdAt }),
  );

  fireAndForgetAudit(dependencies, {
    conversationId: conversation.id,
    action: "INTENT_ROUTED",
    payload: {
      lineEventId: event.lineEventId,
      intent: route.intent,
      reason: route.reason,
      allowsSearch: route.allowsSearch,
      requiresAdmin: route.requiresAdmin,
    },
  });

  const aiJob = await dependencies.storeLineAiJob({
    conversationId: conversation.id,
    lineMessageId: inboundMessage.id,
    jobType:
      event.messageType === LineMessageType.IMAGE
        ? imageClassification?.kind === "payment_slip"
          ? LineAiJobType.PAYMENT_SLIP_OCR
          : LineAiJobType.IMAGE_ANALYSIS
        : LineAiJobType.TEXT_REPLY,
    status: LineAiJobStatus.PENDING,
    payload: {
      lineEventId: event.lineEventId,
      lineUserId,
      replyToken: event.replyToken,
      canReply: event.canReply,
      messageType: event.messageType,
      text: event.text,
      route,
      // Store the FULL structured classification (minus the raw image bytes /
      // slip OCR) so a later owner re-run or the cron recovery — which start with
      // an empty in-memory cache — can reuse it instead of paying for a second
      // Gemini vision call (B2a). Vision then runs exactly once per image, ever.
      imageClassification: imageClassification
        ? serializeClassificationForReuse(imageClassification)
        : null,
    },
  });

  return { conversation, inboundMessage, route, imageClassification, aiJob };
}

export async function processLineWebhookPayload(
  payload: { events?: unknown[] },
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies = defaultDependencies,
): Promise<LineWebhookProcessResult> {
  // Toggles come from the admin settings page (resolved by the caller). Safe
  // defaults when omitted: AI off, dry-run on, image-search off.
  const imageSearchEnabled = config.imageSearchEnabled ?? LINE_AI_SETTINGS_DEFAULTS.imageSearchEnabled;
  const events = normalizeLineWebhookEvents(payload as Parameters<typeof normalizeLineWebhookEvents>[0]);
  const result: LineWebhookProcessResult = {
    processedCount: 0,
    duplicateCount: 0,
    skippedCount: 0,
    repliedCount: 0,
  };

  if (config.coalesce) {
    await processCoalescedEvents(events, config, dependencies, imageSearchEnabled, result);
    return result;
  }

  for (const event of events) {
    if (!event.lineUserId) {
      result.skippedCount += 1;
      continue;
    }

    if (await dependencies.hasProcessedLineEvent(event.lineEventId)) {
      result.duplicateCount += 1;
      continue;
    }

    try {
      const { conversation, inboundMessage, route, imageClassification, aiJob } = await ingestLineEvent(
        event,
        config,
        dependencies,
        imageSearchEnabled,
      );

      const replyResult = await processLineAiReply(
        {
          jobId: aiJob.id,
          conversation,
          inboundMessage,
          lineUserId: event.lineUserId,
          replyToken: event.replyToken,
          canReply: event.canReply,
          messageType: event.messageType,
          route,
          text: event.text,
          imageClassification,
          lineEventId: event.lineEventId,
        },
        config,
        dependencies,
      );

      if (replyResult.replied) {
        result.repliedCount += 1;
      }

      result.processedCount += 1;
    } catch (error) {
      // Race fallback: a concurrent processor inserted the inbound row first.
      // Count as duplicate, never re-process — the other worker owns the reply.
      if (error instanceof DuplicateLineEventError) {
        result.duplicateCount += 1;
        continue;
      }
      // Any other error: log and continue with the next event in the batch so
      // one bad event never starves the rest of a multi-event payload.
      console.error(
        "[line-webhook-processor] event failed; continuing with batch",
        { lineEventId: event.lineEventId, error: error instanceof Error ? error.message : String(error) },
      );
      result.skippedCount += 1;
    }
  }

  return result;
}

// ── Coalescing engine ───────────────────────────────────────────────────────

const DEFAULT_COALESCE_WINDOW_MS = 3_000;
const DEFAULT_COALESCE_LEASE_MS = 60_000;
// B2b: once this much wall-clock has elapsed since the request was received, the
// owner stops debouncing/re-looping and does ONE forced final pass (force-send,
// never abort) so a reply lands before the 60s serverless ceiling kills the
// function mid-flight (which previously stranded the lock → a ~2min cron-recovery
// re-run). The final pass still runs the full OCR→search→reply pipeline (OCR is
// reused via B2a), so the reply is always grounded — we only stop WAITING, never
// answer before the data is ready.
const OWNER_LOOP_FINAL_PASS_AFTER_MS = 28_000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type UnansweredLineMessage = Awaited<ReturnType<typeof getUnansweredInboundLineMessages>>[number];

/**
 * Coalesced inbound handling (Option A). Phase 1 ingests every event WITHOUT
 * replying (persist + classify + bump seq). Phase 2 elects ONE owner per
 * conversation (a short-lived lock) that runs a debounce + abort-on-newer loop:
 * it waits for the customer to go quiet, merges all unanswered messages into a
 * single turn, and only sends once a processing pass completes with no newer
 * message — so a burst of images/texts yields exactly ONE reply on the latest
 * reply token. Stickers keep their legacy greet-once / silent handling.
 */
async function processCoalescedEvents(
  events: NormalizedLineEvent[],
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
  imageSearchEnabled: boolean,
  result: LineWebhookProcessResult,
): Promise<void> {
  const bumpSeq = dependencies.bumpLineInboundSeq ?? bumpLineInboundSeq;
  // conversationId → { conversation, lineUserId }; classifications cached by
  // lineMessageId so the owner doesn't re-call vision for same-payload images.
  const touched = new Map<string, { conversation: Awaited<ReturnType<typeof getOrCreateLineConversation>>; lineUserId: string }>();
  const classByMessageId = new Map<string, LineImageClassification>();

  for (const event of events) {
    if (!event.lineUserId) {
      result.skippedCount += 1;
      continue;
    }
    if (await dependencies.hasProcessedLineEvent(event.lineEventId)) {
      result.duplicateCount += 1;
      continue;
    }

    try {
      // Stickers never coalesce — keep the legacy greet-once / silent path so a
      // closing 🙏 sticker doesn't get folded into a product turn.
      if (event.messageType === LineMessageType.STICKER) {
        const { conversation, inboundMessage, route, imageClassification, aiJob } = await ingestLineEvent(
          event,
          config,
          dependencies,
          imageSearchEnabled,
        );
        const replyResult = await processLineAiReply(
          {
            jobId: aiJob.id,
            conversation,
            inboundMessage,
            lineUserId: event.lineUserId,
            replyToken: event.replyToken,
            canReply: event.canReply,
            messageType: event.messageType,
            route,
            text: event.text,
            imageClassification,
            lineEventId: event.lineEventId,
          },
          config,
          dependencies,
        );
        if (replyResult.replied) result.repliedCount += 1;
        result.processedCount += 1;
        continue;
      }

      const { conversation, inboundMessage, imageClassification, aiJob } = await ingestLineEvent(
        event,
        config,
        dependencies,
        imageSearchEnabled,
      );
      // The per-event PENDING job created during ingest is NOT the unit of work in
      // coalesced mode — the owner processes one merged job for the whole turn.
      // Close it immediately so the cron failsafe (which reprocesses stale PENDING
      // jobs one-by-one, legacy-style) can never resurrect it into a duplicate
      // reply. Crash recovery is handled by the conversation-level seq failsafe.
      await dependencies
        .updateLineAiJob(aiJob.id, {
          status: LineAiJobStatus.COMPLETED,
          result: { action: "coalesced_ingest" },
          finishedAt: new Date(),
        })
        .catch(() => undefined);
      if (imageClassification && event.lineMessageId) {
        classByMessageId.set(event.lineMessageId, imageClassification);
      }
      await bumpSeq(conversation.id);
      // Typing dots are fired inside ingestLineEvent (before the image vision
      // call), so they're already showing by the time we get here.
      touched.set(conversation.id, { conversation, lineUserId: event.lineUserId });
      result.processedCount += 1;
      // inboundMessage intentionally not used further here — the owner re-reads
      // the unanswered set from the DB so cross-payload bursts are included.
      void inboundMessage;
    } catch (error) {
      if (error instanceof DuplicateLineEventError) {
        result.duplicateCount += 1;
        continue;
      }
      console.error(
        "[line-webhook-processor] coalesced ingest failed; continuing with batch",
        { lineEventId: event.lineEventId, error: error instanceof Error ? error.message : String(error) },
      );
      result.skippedCount += 1;
    }
  }

  // Phase 2 — elect an owner per touched conversation and run its turn.
  const acquire = dependencies.acquireLineConversationLock ?? acquireLineConversationLock;
  const release = dependencies.releaseLineConversationLock ?? releaseLineConversationLock;
  const leaseMs = config.coalesceLeaseMs ?? DEFAULT_COALESCE_LEASE_MS;

  for (const [conversationId, info] of touched) {
    const owner = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const acquired = await acquire({ conversationId, owner, leaseMs }).catch(() => false);
    if (!acquired) {
      // Another worker owns this conversation's burst — our messages are already
      // persisted + seq-bumped, so that owner will pick them up. Nothing to do.
      continue;
    }
    try {
      const replied = await runConversationOwnerLoop({
        conversationId,
        owner,
        info,
        config,
        dependencies,
        imageSearchEnabled,
        classByMessageId,
      });
      if (replied) result.repliedCount += 1;
    } catch (error) {
      console.error(
        "[line-webhook-processor] owner loop failed",
        { conversationId, error: error instanceof Error ? error.message : String(error) },
      );
    } finally {
      await release({ conversationId, owner }).catch(() => undefined);
    }
  }
}

/**
 * Coalescing crash failsafe (run from the cron). The webhook normally owns and
 * replies to a burst inside after(); if that invocation dies (timeout/crash)
 * after persisting messages but before replying, the conversation is left with
 * unanswered customer messages and no live owner. This finds those (seq newer
 * than processed + lock free + quiet long enough that a live owner would have
 * finished) and re-runs the owner loop. The lock + quiet window keep it from
 * racing a still-running live owner, so it never produces a duplicate reply.
 */
export async function recoverStalledCoalescedConversations(
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies = defaultDependencies,
  options?: { quietForMs?: number; take?: number },
): Promise<{ scanned: number; replied: number }> {
  const imageSearchEnabled = config.imageSearchEnabled ?? LINE_AI_SETTINGS_DEFAULTS.imageSearchEnabled;
  const findStalled = dependencies.findStalledCoalescedConversationIds ?? findStalledCoalescedConversationIds;
  const getConv = dependencies.getLineConversationForRecovery ?? getLineConversationForRecovery;
  const acquire = dependencies.acquireLineConversationLock ?? acquireLineConversationLock;
  const release = dependencies.releaseLineConversationLock ?? releaseLineConversationLock;
  const leaseMs = config.coalesceLeaseMs ?? DEFAULT_COALESCE_LEASE_MS;
  const quietForMs = options?.quietForMs ?? 90_000;

  const ids = await findStalled({
    quietBefore: new Date(Date.now() - quietForMs),
    take: options?.take ?? 10,
  }).catch(() => [] as string[]);

  let replied = 0;
  for (const conversationId of ids) {
    const conversation = await getConv(conversationId).catch(() => null);
    if (!conversation) continue;
    const owner = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const acquired = await acquire({ conversationId, owner, leaseMs }).catch(() => false);
    if (!acquired) continue; // a live owner still holds it — leave it alone
    try {
      const didReply = await runConversationOwnerLoop({
        conversationId,
        owner,
        info: { conversation, lineUserId: conversation.lineUserId },
        config,
        dependencies,
        imageSearchEnabled,
        classByMessageId: new Map(),
      });
      if (didReply) replied += 1;
    } catch (error) {
      console.error("[line-webhook-processor] coalesce recovery failed", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await release({ conversationId, owner }).catch(() => undefined);
    }
  }
  return { scanned: ids.length, replied };
}

/**
 * Owner loop: debounce → merge unanswered → process → abort-on-newer. Loops until
 * a processing pass completes with no newer customer message (clean pass), then
 * the reply has already been sent inside {@link processLineAiReply}. No cap — a
 * customer who never stops typing simply keeps extending the turn (by design).
 */
async function runConversationOwnerLoop(args: {
  conversationId: string;
  owner: string;
  info: { conversation: Awaited<ReturnType<typeof getOrCreateLineConversation>>; lineUserId: string };
  config: LineWebhookProcessorConfig;
  dependencies: LineWebhookProcessorDependencies;
  imageSearchEnabled: boolean;
  classByMessageId: Map<string, LineImageClassification>;
}): Promise<boolean> {
  const { conversationId, owner, info, config, dependencies, imageSearchEnabled, classByMessageId } = args;
  const getState = dependencies.getLineCoalesceState ?? getLineCoalesceState;
  const getUnanswered = dependencies.getUnansweredInboundLineMessages ?? getUnansweredInboundLineMessages;
  const markProcessed = dependencies.markLineProcessedSeq ?? markLineProcessedSeq;
  const renew = dependencies.renewLineConversationLock ?? renewLineConversationLock;
  const sleep = dependencies.sleep ?? realSleep;
  const windowMs = config.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
  const leaseMs = config.coalesceLeaseMs ?? DEFAULT_COALESCE_LEASE_MS;

  // Budget clock starts when the webhook received the request (the 60s ceiling is
  // measured from there). Recovery has no receivedAt → measure from loop entry.
  const budgetStartMs = config.receivedAt?.getTime() ?? Date.now();

  // Bounded by the wall-clock budget (B2b) and the lock lease being renewed each
  // pass. Within budget the loop debounces + re-arms on every newer message
  // ("wait until the customer is truly done"); past budget it forces one final
  // grounded send so the function isn't killed mid-flight.
  while (true) {
    const before = await getState(conversationId);
    if (!before) return false;

    // B2b: past the budget, skip the debounce wait and force a final send below.
    const finalPass = Date.now() - budgetStartMs >= OWNER_LOOP_FINAL_PASS_AFTER_MS;

    let state = before;
    if (!finalPass) {
      // Debounce: wait for the customer to stop sending. If a new message lands
      // during the wait, the seq changes and we re-arm the window.
      await sleep(windowMs);
      const after = await getState(conversationId);
      if (!after) return false;
      if (after.lastInboundSeq !== before.lastInboundSeq) continue;
      state = after;
    }

    const messages = await getUnanswered(conversationId);
    if (messages.length === 0) {
      // Nothing in the burst window to answer (already replied, or the only
      // unanswered rows are stale and aged out). Advance the processed marker so
      // the recovery failsafe doesn't keep re-selecting this conversation.
      await markProcessed({ conversationId, seq: state.lastInboundSeq }).catch(() => undefined);
      return false;
    }

    await renew({ conversationId, owner, leaseMs }).catch(() => undefined);

    if (finalPass) {
      fireAndForgetAudit(dependencies, {
        conversationId,
        action: "AI_OWNER_BUDGET_FORCED_SEND",
        payload: { elapsedMs: Date.now() - budgetStartMs, coalescedCount: messages.length },
      });
    }

    const processSnapshot = state.lastInboundSeq;
    const turn = await buildMergedTurnInput({
      conversationId,
      conversation: { ...info.conversation, aiStatus: state.aiStatus },
      lineUserId: info.lineUserId,
      messages,
      config,
      dependencies,
      imageSearchEnabled,
      classByMessageId,
    });

    const aiJob = await dependencies.storeLineAiJob({
      conversationId,
      lineMessageId: turn.inboundMessage.id,
      jobType:
        turn.messageType === LineMessageType.IMAGE
          ? LineAiJobType.IMAGE_ANALYSIS
          : LineAiJobType.TEXT_REPLY,
      status: LineAiJobStatus.PENDING,
      payload: {
        coalesced: true,
        coalescedCount: messages.length,
        processSnapshot,
        messageType: turn.messageType,
        text: turn.text,
        route: turn.route,
      },
    });

    // On the forced final pass we never abort — the budget is spent, so this send
    // must land (the customer would otherwise get nothing before the kill). Within
    // budget, abort if a newer message arrived so we re-merge and re-run.
    const shouldAbortBeforeSend = finalPass
      ? async () => false
      : async () => {
          const current = await getState(conversationId).catch(() => null);
          return Boolean(current && current.lastInboundSeq !== processSnapshot);
        };

    const replyResult = await processLineAiReply(
      {
        jobId: aiJob.id,
        conversation: turn.conversation,
        inboundMessage: turn.inboundMessage,
        lineUserId: info.lineUserId,
        replyToken: turn.replyToken,
        canReply: true,
        messageType: turn.messageType,
        route: turn.route,
        text: turn.text,
        imageClassification: turn.imageClassification,
        lineEventId: turn.lineEventId,
        shouldAbortBeforeSend,
      },
      {
        ...config,
        receivedAt: config.receivedAt ?? turn.receivedAt ?? undefined,
      },
      dependencies,
    );

    if ("aborted" in replyResult && replyResult.aborted) {
      // A newer message arrived during processing — merge it and re-run.
      continue;
    }

    await markProcessed({ conversationId, seq: processSnapshot }).catch(() => undefined);
    return replyResult.replied;
  }
}

/**
 * Merges all unanswered inbound messages of a burst into a single turn: combined
 * text, a unified image classification (union of part-image search hints), and
 * the latest reply token. Image messages whose classification wasn't cached this
 * payload (cross-payload bursts) are re-classified on demand.
 */
async function buildMergedTurnInput(args: {
  conversationId: string;
  conversation: Awaited<ReturnType<typeof getOrCreateLineConversation>>;
  lineUserId: string;
  messages: UnansweredLineMessage[];
  config: LineWebhookProcessorConfig;
  dependencies: LineWebhookProcessorDependencies;
  imageSearchEnabled: boolean;
  classByMessageId: Map<string, LineImageClassification>;
}): Promise<{
  conversation: Awaited<ReturnType<typeof getOrCreateLineConversation>>;
  inboundMessage: { id: string };
  messageType: LineMessageType;
  route: ReturnType<typeof routeChatIntent>;
  text: string | null;
  imageClassification: LineImageClassification | null;
  replyToken: string | null;
  lineEventId: string | null;
  receivedAt: Date | null;
}> {
  const { conversation, messages, config, dependencies, imageSearchEnabled, classByMessageId } = args;
  const classify = dependencies.classifyLineImage ?? classifyLineImage;

  const latest = messages[messages.length - 1];
  const mergedText =
    messages
      .map((message) => message.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim() || null;

  const imageMessages = messages.filter((message) => message.messageType === LineMessageType.IMAGE);
  let imageClassification: LineImageClassification | null = null;
  if (imageMessages.length > 0) {
    // B2a: before re-calling vision, pull any ingest-time classification stored on
    // the message's job payload. On a fresh same-payload run this is redundant
    // with classByMessageId, but on an owner re-run / cron recovery (empty
    // in-memory cache) it means we reuse the OCR instead of paying for it twice.
    const getStored =
      dependencies.getStoredImageClassificationsByMessageRowIds ?? getStoredImageClassificationsByMessageRowIds;
    const storedByRowId = await getStored(imageMessages.map((m) => m.id)).catch(
      () => new Map<string, unknown>(),
    );
    // Classify every uncached image CONCURRENTLY (vision is reply-token-bound and
    // each call is independent) — a sequential loop adds up across a multi-image
    // burst and blows the 60s webhook budget. Order is preserved so the
    // structured-field merge below stays deterministic (e.g. brand off the plate,
    // part type off the part photo). Per-image failures degrade to null.
    const resolvedList = await Promise.all(
      imageMessages.map((message) => {
        const cached = message.lineMessageId ? classByMessageId.get(message.lineMessageId) : undefined;
        if (cached) return Promise.resolve(cached);
        const stored = deserializeStoredClassification(storedByRowId.get(message.id));
        if (stored) return Promise.resolve(stored);
        return classify({
          channelAccessToken: config.channelAccessToken,
          lineMessageId: message.lineMessageId,
        }).catch(() => null);
      }),
    );
    const classifications: LineImageClassification[] = resolvedList.filter(
      (c): c is LineImageClassification => c !== null,
    );

    // Kind priority: a real part image wins (so the turn searches); else a slip;
    // else unknown. Search hints are the union from every part image.
    const partImages = classifications.filter((c) => c.kind === "part_image");
    const slip = classifications.find((c) => c.kind === "payment_slip");
    const chosen = partImages[0] ?? slip ?? classifications[0] ?? null;
    if (chosen) {
      const hintSet = new Set<string>();
      for (const c of classifications) {
        if (c.kind === "part_image") for (const hint of c.searchHints) hintSet.add(hint);
      }
      // Merge the STRUCTURED fields across every part image (first non-null
      // wins). A burst often splits the answer across photos — the car brand is
      // on the registration plate while the part type is on the actual part
      // photo — so picking fields from a single "chosen" image throws away half
      // the OCR and makes the gate re-ask for detail the customer already sent.
      const firstPartField = <K>(pick: (c: LineImageClassification) => K | null | undefined): K | null => {
        for (const c of partImages) {
          const value = pick(c);
          if (value != null) return value;
        }
        return null;
      };
      imageClassification = {
        ...chosen,
        searchHints: Array.from(hintSet),
        ...(partImages.length > 0
          ? {
              partType: firstPartField((c) => c.partType),
              carBrand: firstPartField((c) => c.carBrand),
              carModel: firstPartField((c) => c.carModel),
              year: firstPartField((c) => c.year),
              partNumber: firstPartField((c) => c.partNumber),
              chassisNumber: firstPartField((c) => c.chassisNumber),
              partKind: firstPartField((c) => c.partKind),
            }
          : {}),
      };
    }
  }

  const hasText = Boolean(mergedText);
  const messageType = hasText
    ? LineMessageType.TEXT
    : imageMessages.length > 0
      ? LineMessageType.IMAGE
      : latest.messageType;

  // Text present → drive routing from the merged text (image hints still feed the
  // search via imageClassification.searchHints). Image-only → route from the
  // unified classification. This also dissolves the original bug: a stray
  // unknown_image can no longer hijack a turn that has real text or a part image.
  let route = routeChatIntent({ messageType, text: mergedText });
  if (!hasText && imageClassification) {
    route = applyImageClassificationToRoute(route, imageClassification, imageSearchEnabled);
  }

  return {
    conversation,
    inboundMessage: { id: latest.id },
    messageType,
    route,
    text: mergedText,
    imageClassification,
    replyToken: latest.replyToken ?? null,
    lineEventId: latest.lineEventId ?? null,
    receivedAt: latest.createdAt ?? null,
  };
}
