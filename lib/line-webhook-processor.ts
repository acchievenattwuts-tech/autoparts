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
  buildJuneSmalltalkReply,
  buildJuneSocialReply,
  extractLineSearchIntent,
  generateLineSuggestion,
  generateScopedConversationalReply,
  type LineReplyHistoryItem,
} from "@/lib/line-ai-service";
import { resolveLineFitmentFilters, type LineFitmentFilters } from "@/lib/line-fitment-resolve";
import { groupToRoute, intentToGroup, type LineMessageGroup } from "@/lib/line-intent-groups";
import { resolveLineAiSendDecision } from "@/lib/line-ai-policy";
import {
  acquireLineConversationLock,
  appendLineMessage,
  bumpLineInboundSeq,
  DuplicateLineEventError,
  countConsecutiveFailedLineSearches,
  countPendingPaymentSlipsForConversation,
  findActiveCustomerIdByLineUserId,
  findStalledCoalescedConversationIds,
  getLineCoalesceState,
  getLineConversationForRecovery,
  getOrCreateLineConversation,
  getRecentLineMessagesForAi,
  getUnansweredInboundLineMessages,
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
import { routeLineIntent } from "@/lib/line-intent-router";
import { pushLineMessages, replyLineMessage } from "@/lib/line-messaging";
import { getLineProductSummaries, searchLineProductInquiry } from "@/lib/line-product-search-bridge";
import { buildProductFlexMessage, resolveFlexPlaceholderImageUrl } from "@/lib/line-flex-product-card";
import { classifyPurchaseIntent } from "@/lib/line-purchase-intent";
import { extractFitmentTerms } from "@/lib/line-fitment-extract";
import { answerFromLineFaq } from "@/lib/line-faq";
import { normalizeLineWebhookEvents } from "@/lib/line-webhook-events";
import { notifyLineOaNeedsAdmin } from "@/lib/notifications";
import type { LinePushMessage } from "@/lib/line-daily-summary";
import { guardLineSearchIntent } from "@/lib/line-search-guards";
import {
  buildLineSearchAskReply,
  buildLineSearchFollowUp,
  decideLineSearchGate,
} from "@/lib/line-search-gate";

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
  getOrCreateLineConversation: typeof getOrCreateLineConversation;
  appendLineMessage: typeof appendLineMessage;
  updateLineConversationState: typeof updateLineConversationState;
  storeLineAiAudit: typeof storeLineAiAudit;
  storeLineAiSuggestion: typeof storeLineAiSuggestion;
  markOutboundLineMessageSent: typeof markOutboundLineMessageSent;
  storeLineAiJob: typeof storeLineAiJob;
  updateLineAiJob: typeof updateLineAiJob;
  searchLineProductInquiry: typeof searchLineProductInquiry;
  getLineProductSummaries: typeof getLineProductSummaries;
  replyLineMessage: typeof replyLineMessage;
  pushLineMessages: typeof pushLineMessages;
  /** Optional override; defaults to the Gemini-backed generator with rule-based fallback. */
  generateLineSuggestion?: typeof generateLineSuggestion;
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
  answerFromLineFaq?: typeof answerFromLineFaq;
  /** Optional override; extracts the running search subject + structured fitment
   *  hints from conversation history (search-side memory for drip-fed details). */
  extractLineSearchIntent?: typeof extractLineSearchIntent;
  /** Optional override; resolves AI fitment hints to canonical master-data names
   *  for use as precise hard filters in product search. */
  resolveLineFitmentFilters?: typeof resolveLineFitmentFilters;
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
  findStalledCoalescedConversationIds?: typeof findStalledCoalescedConversationIds;
  getLineConversationForRecovery?: typeof getLineConversationForRecovery;
  /** Injectable debounce sleep (default real setTimeout; tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
};

const defaultDependencies: LineWebhookProcessorDependencies = {
  hasProcessedLineEvent,
  findActiveCustomerIdByLineUserId,
  getOrCreateLineConversation,
  appendLineMessage,
  updateLineConversationState,
  storeLineAiAudit,
  storeLineAiSuggestion,
  markOutboundLineMessageSent,
  storeLineAiJob,
  updateLineAiJob,
  searchLineProductInquiry,
  getLineProductSummaries,
  replyLineMessage,
  pushLineMessages,
  generateLineSuggestion,
  classifyLineImage,
  ingestPaymentSlip,
  notifyLineOaNeedsAdmin,
  getRecentLineMessagesForAi,
  countConsecutiveFailedLineSearches,
  countPendingPaymentSlipsForConversation,
  classifyPurchaseIntent,
  answerFromLineFaq,
  extractLineSearchIntent,
  resolveLineFitmentFilters,
  generateScopedConversationalReply,
  acquireLineConversationLock,
  releaseLineConversationLock,
  renewLineConversationLock,
  bumpLineInboundSeq,
  getLineCoalesceState,
  markLineProcessedSeq,
  getUnansweredInboundLineMessages,
  findStalledCoalescedConversationIds,
  getLineConversationForRecovery,
};

const MAX_FAILED_SEARCHES_BEFORE_HANDOFF = 2;
// Safety margin before the reply-token window closes: send the (deterministic)
// reply this many ms early so it still goes out on the FREE reply token.
const REPLY_DEADLINE_MARGIN_MS = 5_000;
const NO_RESULTS_ESCALATION_MESSAGE =
  "ขอโทษนะคะ 🙏 จูนยังหาตัวที่ตรงกับที่แจ้งไม่เจอในระบบค่ะ ขอส่งต่อให้แอดมินช่วยตรวจสอบและติดต่อกลับอีกครั้งนะคะ ระหว่างนี้ถ้ามีปีรถ รุ่นย่อย หรือรูปอะไหล่เดิม ส่งเพิ่มมาได้เลยค่ะ 😊";
const PURCHASE_HANDOFF_MESSAGE =
  "รับทราบค่ะ 😊 เดี๋ยวแอดมินมาช่วยสรุปราคาและการจัดส่งให้นะคะ รอสักครู่นะคะ 🙏";
// Sent as a bubble AFTER the matched products on a price inquiry — the customer
// sees the options, and the exact price/promo is confirmed by a human.
const PRICE_INQUIRY_DEFER_NOTE =
  "ส่วนเรื่องราคา/โปรโมชั่น เดี๋ยวจูนให้แอดมินมาช่วยสรุปให้นะคะ 🙏";
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
  history: LineReplyHistoryItem[],
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
  history: LineReplyHistoryItem[],
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
): LineReplyHistoryItem[] {
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
  base: ReturnType<typeof routeLineIntent>,
  classification: LineImageClassification,
  imageSearchEnabled: boolean,
): ReturnType<typeof routeLineIntent> {
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

function textMessage(text: string): LinePushMessage {
  return {
    type: "text",
    text,
  };
}

function canUseReplyToken(config: LineWebhookProcessorConfig, canReply: boolean) {
  if (!canReply || !config.channelAccessToken) return false;

  const receivedAt = config.receivedAt;
  if (!receivedAt) return true;

  const maxAgeMs = config.replyTokenMaxAgeMs ?? 45_000;
  return Date.now() - receivedAt.getTime() <= maxAgeMs;
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
  route: ReturnType<typeof routeLineIntent>;
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
    const recentMessages = await (dependencies.getRecentLineMessagesForAi ?? getRecentLineMessagesForAi)(
      input.conversation.id,
      10,
    ).catch(() => []);
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
    const hardGuard = layer1Group === "payment" || layer1Group === "claim_or_return";
    // True when the regex flagged a price/buy intent — used to (a) skip the
    // purchase hand-off when it's really a price *inquiry* we can answer with
    // products, and (b) append a "price → admin" note after the matches.
    const regexPriceIntent =
      input.route.intent === LineIntent.PURCHASE_INTENT ||
      input.route.intent === LineIntent.PRICE_NEGOTIATION;
    const shouldClassify = isTextTurn && !hardGuard;
    const searchIntent = shouldClassify
      ? await (dependencies.extractLineSearchIntent ?? extractLineSearchIntent)({
          intent: input.route.intent,
          latestText: input.text,
          history,
        }).catch(() => null)
      : null;
    const classifyFailed = shouldClassify && searchIntent === null;
    const group: LineMessageGroup = shouldClassify ? searchIntent?.group ?? layer1Group : layer1Group;

    // Effective route from the group (reuses the existing forced-response / hand-off
    // / policy machinery). general_faq / social / other have no 1:1 intent → keep
    // the Layer-1 route and drive them with the flags below. Non-text turns keep
    // their original route untouched.
    const route = isTextTurn ? groupToRoute(group) ?? input.route : input.route;
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

    // Intent-gated retrieval: only `product` turns search + attach cards. Every
    // other group answers from a template/FAQ or hands off — so stale product
    // context can never leak into answers to "ร้านอยู่ที่ไหน" etc.
    const isNonProductTurn = group !== "product";
    const guardedSearch = isNonProductTurn
      ? { intent: searchIntent, forceLiteralQuery: false, requiredTokens: [] }
      : guardLineSearchIntent({ intent: searchIntent, latestText: input.text, history });
    const guardedSearchIntent = guardedSearch.intent;
    const consolidatedQuery = isNonProductTurn
      ? null
      : guardedSearch.forceLiteralQuery
        ? input.text?.trim() || null
        : guardedSearchIntent?.query ?? null;

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
        ? decideLineSearchGate({
            partType: input.imageClassification.partType ?? null,
            carBrand: input.imageClassification.carBrand ?? null,
            carModel: input.imageClassification.carModel ?? null,
            year: input.imageClassification.year ?? null,
            partKind: input.imageClassification.partKind,
            tooBroad: false,
          })
        : null;
    const gateDecision =
      !isNonProductTurn && guardedSearchIntent
        ? decideLineSearchGate({
            partType: guardedSearchIntent.partType,
            carBrand: guardedSearchIntent.carBrand,
            carModel: guardedSearchIntent.carModel,
            year: guardedSearchIntent.year,
            partKind: guardedSearchIntent.partKind,
            tooBroad: guardedSearchIntent.tooBroad,
          })
        : imageGateDecision;
    const gateBlocksSearch = gateDecision?.action === "ask";
    const searchFollowUp = gateDecision?.action === "search" ? gateDecision.followUp : null;

    // Resolve the AI's brand/model/part-type hints to canonical master-data names
    // for use as precise hard filters (drops anything that doesn't resolve, so a
    // typo can never zero-out the search — the free-text query still runs).
    const fitmentFilters: LineFitmentFilters =
      !isNonProductTurn && guardedSearchIntent
        ? await (dependencies.resolveLineFitmentFilters ?? resolveLineFitmentFilters)({
            partType: guardedSearchIntent.partType,
            carBrand: guardedSearchIntent.carBrand,
            carModel: guardedSearchIntent.carModel,
            queryText: consolidatedQuery ?? input.text,
          }).catch((): LineFitmentFilters => ({}))
        : {};

    // When the AI gave us a consolidated query it already merged the whole
    // subject, so the narrow fitment carryover is redundant. Otherwise keep the
    // deterministic carryover so a follow-up with no car/year still stays on-target.
    const contextHints = consolidatedQuery
      ? []
      : extractFitmentTerms(input.text).length > 0
        ? []
        : findRecentFitmentTerms(recentMessages, input.inboundMessage.id);

    const productSearch = isNonProductTurn || gateBlocksSearch
      ? ({
          searched: false,
          reason: gateBlocksSearch ? `GATE_ASK:${gateDecision?.reason ?? ""}` : "NON_PRODUCT_TURN",
          query: null,
          result: null,
        } as Awaited<ReturnType<typeof searchLineProductInquiry>>)
      : await dependencies.searchLineProductInquiry({
          route,
          text: consolidatedQuery ?? input.text,
          extractedImageHints: input.imageClassification?.searchHints ?? null,
          contextHints,
          fitmentHints: {
            categoryName: fitmentFilters.categoryName ?? null,
            carBrandName: fitmentFilters.carBrandName ?? null,
            carModelName: fitmentFilters.carModelName ?? null,
            fitmentYear: guardedSearchIntent?.year ?? null,
          },
        });

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

    // Pull real catalog names for matched ids so the reply can show the customer
    // what was actually found (with a "verify before ordering" caveat) instead of
    // gatekeeping on chassis/OEM numbers they usually can't provide.
    const products =
      productSearch.searched && productSearch.result.ids.length > 0
        ? await dependencies.getLineProductSummaries(productSearch.result.ids).catch(() => [])
        : [];

    // (#2) Kick the reply generation off NOW, in parallel with the purchase-intent
    // classification below — neither depends on the other, so this removes one
    // sequential Gemini call from the critical path on the slow product-match
    // turns. If a forced response (purchase / escalate / FAQ / shop info) ends up
    // winning, this result is simply discarded.
    const generateSuggestion = dependencies.generateLineSuggestion ?? generateLineSuggestion;
    const wantEarlyGenerate =
      liveMode &&
      (route.intent === LineIntent.PRODUCT_INQUIRY_TEXT ||
        route.intent === LineIntent.PART_IMAGE_INQUIRY ||
        route.intent === LineIntent.GREETING);
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

    // FAQ grounding (จูน's voice, never fabricated). Try a grounded answer when:
    //  - a product search came back empty (the "question" may be shipping/warranty/
    //    how-to-order, not a part), OR
    //  - it's a NON-product turn that the keyword router didn't already route to the
    //    canned SHOP_INFO answer (e.g. "ร้านคุณอยู่ไหน" phrased so the regex misses).
    // This lets the AI actually ANSWER a general/shop question instead of punting it
    // to an admin.
    const faqAnswer =
      liveMode &&
      (tryFaqThenAsk ||
        (isNonProductTurn && route.intent !== LineIntent.SHOP_INFO) ||
        (productSearch.searched && productSearch.result.total === 0))
        ? await (dependencies.answerFromLineFaq ?? answerFromLineFaq)({ text: input.text }).catch(() => ({
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
      // Pre-search gate asked for a missing detail (part/car/year/too-broad).
      // Never a hand-off — the AI stays active and waits for the answer.
      liveMode && gateBlocksSearch && gateDecision?.action === "ask"
        ? {
            message: buildLineSearchAskReply(gateDecision.ask),
            reason: `GATE_ASK_${gateDecision.ask}`,
            handoff: false,
            audit: "AI_SEARCH_GATE_ASK",
            auditPayload: { lineEventId: input.lineEventId, ask: gateDecision.ask, reason: gateDecision.reason },
          }
        : faqAnswer.answered
        ? { message: faqAnswer.reply, reason: "FAQ", handoff: false }
        : liveMode && shouldEscalateNoResults
          ? {
              message: NO_RESULTS_ESCALATION_MESSAGE,
              reason: `ESCALATE_NO_RESULTS_x${failedSearchCount}`,
              handoff: true,
              audit: "AI_ESCALATE_NO_RESULTS",
              auditPayload: { lineEventId: input.lineEventId, failedSearchCount },
            }
          : liveMode && isPurchaseIntent
          ? {
              message: PURCHASE_HANDOFF_MESSAGE,
              reason: "PURCHASE_INTENT",
              handoff: true,
              audit: "AI_PURCHASE_HANDOFF",
              auditPayload: { lineEventId: input.lineEventId, source: isKeywordPurchase ? "keyword" : "ai" },
            }
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

    if (forcedResponse) {
      suggestion = {
        suggestedReply: forcedResponse.message,
        confidence: forcedResponse.handoff ? LineAiConfidence.ADMIN_REQUIRED : LineAiConfidence.POSSIBLE_MATCH,
        reasoningSummary: forcedResponse.reason,
        matchedProducts: null,
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
          suggestedReply: buildJuneDeadlineReply({ query: consolidatedQuery ?? input.text, products }),
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
    const conversationBlocked =
      input.conversation.aiStatus === LineConversationAiStatus.PAUSED_BY_ADMIN ||
      input.conversation.aiStatus === LineConversationAiStatus.WAITING_ADMIN ||
      input.conversation.aiStatus === LineConversationAiStatus.CLOSED;

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
        });
    // Persona follow-up: after showing the matches, nudge the customer for the
    // one missing detail (year for rule #1, part type for rule #2) so the next
    // turn can pin the exact fit. Sent as its own bubble AFTER the flex cards.
    // Only when we actually showed products (not a forced hand-off / ask).
    // Price inquiries that we answered with products get a "price → admin" note
    // (the shop sets prices, not the AI); it takes precedence over the year/part
    // nudge so we never stack two follow-up bubbles.
    const followUpBubble =
      !forcedResponse && products.length > 0
        ? regexPriceIntent
          ? textMessage(PRICE_INQUIRY_DEFER_NOTE)
          : searchFollowUp
            ? textMessage(buildLineSearchFollowUp(searchFollowUp))
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
  route: ReturnType<typeof routeLineIntent>;
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

  let route = routeLineIntent({ messageType: event.messageType, text: event.text });

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
      imageClassification: imageClassification
        ? {
            kind: imageClassification.kind,
            intent: imageClassification.intent,
            searchHints: imageClassification.searchHints,
            confidence: imageClassification.confidence,
            reason: imageClassification.reason,
          }
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

  // Bounded only by the lock lease being renewed each pass; the loop itself is
  // unbounded per the product spec ("wait until the customer is truly done").
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const before = await getState(conversationId);
    if (!before) return false;

    // Debounce: wait for the customer to stop sending. If a new message lands
    // during the wait, the seq changes and we re-arm the window.
    await sleep(windowMs);
    const after = await getState(conversationId);
    if (!after) return false;
    if (after.lastInboundSeq !== before.lastInboundSeq) continue;

    const messages = await getUnanswered(conversationId);
    if (messages.length === 0) {
      // Nothing in the burst window to answer (already replied, or the only
      // unanswered rows are stale and aged out). Advance the processed marker so
      // the recovery failsafe doesn't keep re-selecting this conversation.
      await markProcessed({ conversationId, seq: after.lastInboundSeq }).catch(() => undefined);
      return false;
    }

    await renew({ conversationId, owner, leaseMs }).catch(() => undefined);

    const processSnapshot = after.lastInboundSeq;
    const turn = await buildMergedTurnInput({
      conversationId,
      conversation: { ...info.conversation, aiStatus: after.aiStatus },
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

    const shouldAbortBeforeSend = async () => {
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
      config,
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
  route: ReturnType<typeof routeLineIntent>;
  text: string | null;
  imageClassification: LineImageClassification | null;
  replyToken: string | null;
  lineEventId: string | null;
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
    const classifications: LineImageClassification[] = [];
    for (const message of imageMessages) {
      const cached = message.lineMessageId ? classByMessageId.get(message.lineMessageId) : undefined;
      const resolved =
        cached ??
        (await classify({
          channelAccessToken: config.channelAccessToken,
          lineMessageId: message.lineMessageId,
        }).catch(() => null));
      if (resolved) classifications.push(resolved);
    }

    // Kind priority: a real part image wins (so the turn searches); else a slip;
    // else unknown. Search hints are the union from every part image.
    const part = classifications.find((c) => c.kind === "part_image");
    const slip = classifications.find((c) => c.kind === "payment_slip");
    const chosen = part ?? slip ?? classifications[0] ?? null;
    if (chosen) {
      const hintSet = new Set<string>();
      for (const c of classifications) {
        if (c.kind === "part_image") for (const hint of c.searchHints) hintSet.add(hint);
      }
      imageClassification = { ...chosen, searchHints: Array.from(hintSet) };
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
  let route = routeLineIntent({ messageType, text: mergedText });
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
  };
}
