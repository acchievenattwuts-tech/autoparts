import {
  LineAiSuggestionStatus,
  LineAiJobStatus,
  LineAiJobType,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineIntent,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
import { classifyLineImage, type LineImageClassification } from "@/lib/line-image-service";
import { LINE_AI_SETTINGS_DEFAULTS } from "@/lib/line-ai-settings";
import { ingestPaymentSlip } from "@/lib/line-payment-slip-ingest";
import { generateLineSuggestion, type LineReplyHistoryItem } from "@/lib/line-ai-service";
import { resolveLineAiSendDecision } from "@/lib/line-ai-policy";
import {
  appendLineMessage,
  findActiveCustomerIdByLineUserId,
  getOrCreateLineConversation,
  getRecentLineMessagesForAi,
  hasProcessedLineEvent,
  markOutboundLineMessageSent,
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
import { buildProductFlexMessage } from "@/lib/line-flex-product-card";
import { normalizeLineWebhookEvents } from "@/lib/line-webhook-events";
import { notifyLineOaNeedsAdmin } from "@/lib/notifications";
import type { LinePushMessage } from "@/lib/line-daily-summary";

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
  /** Optional override; defaults to the in-app admin bell notification (no Telegram). */
  notifyLineOaNeedsAdmin?: typeof notifyLineOaNeedsAdmin;
  /** Optional override; defaults to fetching recent messages for AI short-term memory. */
  getRecentLineMessagesForAi?: typeof getRecentLineMessagesForAi;
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
};

/** Maps stored LINE messages to the AI history shape (oldest → newest). */
function toReplyHistory(
  rows: Awaited<ReturnType<typeof getRecentLineMessagesForAi>>,
  excludeMessageId: string,
): LineReplyHistoryItem[] {
  return rows
    .filter((row) => row.id !== excludeMessageId)
    .map((row) => ({
      role: row.direction === LineMessageDirection.INBOUND ? ("customer" as const) : ("shop" as const),
      text:
        row.text?.trim() ||
        (row.messageType === LineMessageType.IMAGE
          ? "[รูปภาพ]"
          : row.messageType === LineMessageType.STICKER
            ? "[สติกเกอร์]"
            : "[ข้อความ]"),
    }));
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

export type ProcessLineAiReplyInput = {
  jobId: string;
  conversation: Awaited<ReturnType<typeof getOrCreateLineConversation>>;
  inboundMessage: Awaited<ReturnType<typeof appendLineMessage>>;
  lineUserId: string;
  replyToken: string | null;
  canReply: boolean;
  messageType: LineMessageType;
  route: ReturnType<typeof routeLineIntent>;
  text: string | null;
  imageClassification: LineImageClassification | null;
  lineEventId: string | null;
};

export async function processLineAiReply(
  input: ProcessLineAiReplyInput,
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies,
) {
  const startedAt = new Date();
  await dependencies.updateLineAiJob(input.jobId, {
    status: LineAiJobStatus.PROCESSING,
    startedAt,
  });

  try {
    const autoReplyEnabled = config.autoReplyEnabled ?? LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled;
    const dryRun = config.dryRun ?? LINE_AI_SETTINGS_DEFAULTS.dryRun;
    const productSearch = await dependencies.searchLineProductInquiry({
      route: input.route,
      text: input.text,
      extractedImageHints: input.imageClassification?.searchHints ?? null,
    });

    await dependencies.storeLineAiAudit({
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

    // Short-term memory: feed recent turns so the reply doesn't re-ask for
    // details the customer already gave in a previous message (e.g. car model
    // sent as text, then the part photo in a follow-up message).
    const recentMessages = await (dependencies.getRecentLineMessagesForAi ?? getRecentLineMessagesForAi)(
      input.conversation.id,
      10,
    ).catch(() => []);
    const history = toReplyHistory(recentMessages, input.inboundMessage.id);

    // Pull real catalog names for matched ids so the reply can show the customer
    // what was actually found (with a "verify before ordering" caveat) instead of
    // gatekeeping on chassis/OEM numbers they usually can't provide.
    const products =
      productSearch.searched && productSearch.result.ids.length > 0
        ? await dependencies.getLineProductSummaries(productSearch.result.ids).catch(() => [])
        : [];

    const generateSuggestion = dependencies.generateLineSuggestion ?? generateLineSuggestion;
    const suggestion = await generateSuggestion({
      intent: input.route.intent,
      originalText: input.text,
      productSearch,
      history,
      products,
    });

    const hasReplyToken = canUseReplyToken(config, input.canReply);
    const sendDecision = resolveLineAiSendDecision({
      autoReplyEnabled,
      dryRun,
      conversationStatus: input.conversation.aiStatus,
      route: input.route,
      confidence: suggestion.confidence,
      hasReplyToken,
      allowPushFallback: config.allowPushFallback ?? false,
    });

    await dependencies.storeLineAiSuggestion({
      conversationId: input.conversation.id,
      lineMessageId: input.inboundMessage.id,
      intent: input.route.intent,
      suggestedReply: suggestion.suggestedReply,
      confidence: suggestion.confidence,
      matchedProducts: suggestion.matchedProducts ? JSON.parse(JSON.stringify(suggestion.matchedProducts)) : null,
      reasoningSummary: suggestion.reasoningSummary,
      status: sendDecision.action === "send" ? LineAiSuggestionStatus.SENT : LineAiSuggestionStatus.DRAFT,
      deliveryMode: sendDecision.deliveryMode,
      sentAt: sendDecision.action === "send" ? new Date() : null,
    });

    await dependencies.storeLineAiAudit({
      conversationId: input.conversation.id,
      action: "AI_SEND_DECISION",
      payload: {
        lineEventId: input.lineEventId,
        action: sendDecision.action,
        deliveryMode: sendDecision.deliveryMode,
        reason: sendDecision.reason,
      },
    });

    // Product cards (Flex) shown alongside the text reply so the customer can tap
    // through to the real storefront pages. Null when no matches or no base URL.
    const productFlex = buildProductFlexMessage({
      products,
      searchQuery: productSearch.searched ? productSearch.query : null,
      total: productSearch.searched ? productSearch.result.total : 0,
    });
    const outboundMessages = [
      textMessage(suggestion.suggestedReply),
      ...(productFlex ? [productFlex] : []),
    ];

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
        intent: input.route.intent,
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
        intent: input.route.intent,
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

    if (sendDecision.action === "handoff") {
      await dependencies.updateLineConversationState(
        input.conversation.id,
        buildLineConversationStatePatch({
          type: "waiting_admin",
          at: new Date(),
          reason: sendDecision.reason,
        }),
      );
    }

    // Notify admins whenever the AI did NOT auto-reply successfully — i.e. the
    // customer is now waiting for a human (handoff, AI off, dry-run, paused
    // conversation, or failed delivery). Deduped per conversation; never throws
    // into the reply flow.
    if (!(sendDecision.action === "send" && replied)) {
      const notify = dependencies.notifyLineOaNeedsAdmin ?? notifyLineOaNeedsAdmin;
      await notify({
        conversationId: input.conversation.id,
        displayName: input.conversation.displayName,
        text: input.text,
        messageType: input.messageType,
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
    await dependencies.updateLineAiJob(input.jobId, {
      status: LineAiJobStatus.FAILED,
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown LINE AI job failure",
      finishedAt: new Date(),
    });
    throw error;
  }
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

  for (const event of events) {
    if (!event.lineUserId) {
      result.skippedCount += 1;
      continue;
    }

    if (await dependencies.hasProcessedLineEvent(event.lineEventId)) {
      result.duplicateCount += 1;
      continue;
    }

    const customerId = await dependencies.findActiveCustomerIdByLineUserId(event.lineUserId);
    const lineProfile = config.lineProfilesByUserId?.[event.lineUserId] ?? null;
    const conversation = await dependencies.getOrCreateLineConversation({
      lineUserId: event.lineUserId,
      customerId,
      displayName: lineProfile?.displayName ?? null,
      pictureUrl: lineProfile?.pictureUrl ?? null,
    });

    let route = routeLineIntent({
      messageType: event.messageType,
      text: event.text,
    });

    let imageClassification: LineImageClassification | null = null;
    if (event.messageType === LineMessageType.IMAGE) {
      const classify = dependencies.classifyLineImage ?? classifyLineImage;
      imageClassification = await classify({
        channelAccessToken: config.channelAccessToken,
        lineMessageId: event.lineMessageId,
      });
      route = applyImageClassificationToRoute(route, imageClassification, imageSearchEnabled);

      await dependencies.storeLineAiAudit({
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
          lineUserId: event.lineUserId,
          lineMessageId: event.lineMessageId,
          content: imageClassification.content ?? null,
        });

        await dependencies.storeLineAiAudit({
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
      lineUserId: event.lineUserId,
      lineMessageId: event.lineMessageId,
      lineEventId: event.lineEventId,
      replyToken: event.replyToken,
      direction: LineMessageDirection.INBOUND,
      messageType: event.messageType,
      intent: route.intent,
      text: event.text,
      rawEvent: event.rawEvent,
    });

    await dependencies.storeLineAiAudit({
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

    await dependencies.storeLineAiAudit({
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
        lineUserId: event.lineUserId,
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

    const replyResult = await processLineAiReply({
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
    }, config, dependencies);

    if (replyResult.replied) {
      result.repliedCount += 1;
    }

    result.processedCount += 1;
  }

  return result;
}
