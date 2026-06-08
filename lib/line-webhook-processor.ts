import {
  LineAiSuggestionStatus,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineIntent,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
import { classifyLineImage, type LineImageClassification } from "@/lib/line-image-service";
import { LINE_AI_SETTINGS_DEFAULTS } from "@/lib/line-ai-settings";
import { ingestPaymentSlip } from "@/lib/line-payment-slip-ingest";
import { generateLineSuggestion } from "@/lib/line-ai-service";
import { resolveLineAiSendDecision } from "@/lib/line-ai-policy";
import {
  appendLineMessage,
  findActiveCustomerIdByLineUserId,
  getOrCreateLineConversation,
  hasProcessedLineEvent,
  markOutboundLineMessageSent,
  storeLineAiAudit,
  storeLineAiSuggestion,
  updateLineConversationState,
} from "@/lib/line-conversation-repository";
import { buildLineConversationStatePatch } from "@/lib/line-conversation-service";
import { routeLineIntent } from "@/lib/line-intent-router";
import { replyLineMessage } from "@/lib/line-messaging";
import { searchLineProductInquiry } from "@/lib/line-product-search-bridge";
import { normalizeLineWebhookEvents } from "@/lib/line-webhook-events";
import type { LinePushMessage } from "@/lib/line-daily-summary";

export type LineWebhookProcessorConfig = {
  channelAccessToken: string | null;
  autoReplyEnabled?: boolean;
  dryRun?: boolean;
  /** When true, part-image vision hints are fed into product search (default off). */
  imageSearchEnabled?: boolean;
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
  searchLineProductInquiry: typeof searchLineProductInquiry;
  replyLineMessage: typeof replyLineMessage;
  /** Optional override; defaults to the Gemini-backed generator with rule-based fallback. */
  generateLineSuggestion?: typeof generateLineSuggestion;
  /** Optional override; defaults to the Gemini-vision classifier with safe fallback. */
  classifyLineImage?: typeof classifyLineImage;
  /** Optional override; defaults to the full slip ingest (fetch → OCR → store). */
  ingestPaymentSlip?: typeof ingestPaymentSlip;
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
  searchLineProductInquiry,
  replyLineMessage,
  generateLineSuggestion,
  classifyLineImage,
  ingestPaymentSlip,
};

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

export async function processLineWebhookPayload(
  payload: { events?: unknown[] },
  config: LineWebhookProcessorConfig,
  dependencies: LineWebhookProcessorDependencies = defaultDependencies,
): Promise<LineWebhookProcessResult> {
  // Toggles come from the admin settings page (resolved by the caller). Safe
  // defaults when omitted: AI off, dry-run on, image-search off.
  const autoReplyEnabled = config.autoReplyEnabled ?? LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled;
  const dryRun = config.dryRun ?? LINE_AI_SETTINGS_DEFAULTS.dryRun;
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
    const conversation = await dependencies.getOrCreateLineConversation({
      lineUserId: event.lineUserId,
      customerId,
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

    if (!autoReplyEnabled) {
      result.processedCount += 1;
      continue;
    }

    const productSearch = await dependencies.searchLineProductInquiry({
      route,
      text: event.text,
      extractedImageHints: imageClassification?.searchHints ?? null,
    });

    await dependencies.storeLineAiAudit({
      conversationId: conversation.id,
      action: "PRODUCT_SEARCH_SUMMARY",
      payload: productSearch.searched
        ? {
            lineEventId: event.lineEventId,
            searched: true,
            query: productSearch.query,
            total: productSearch.result.total,
            returnedCount: productSearch.result.ids.length,
            needsMoreInfo: productSearch.needsMoreInfo,
          }
        : {
            lineEventId: event.lineEventId,
            searched: false,
            reason: productSearch.reason,
          },
    });

    const generateSuggestion = dependencies.generateLineSuggestion ?? generateLineSuggestion;
    const suggestion = await generateSuggestion({
      intent: route.intent,
      originalText: event.text,
      productSearch,
    });

    const sendDecision = resolveLineAiSendDecision({
      autoReplyEnabled,
      dryRun,
      conversationStatus: conversation.aiStatus,
      route,
      confidence: suggestion.confidence,
      hasReplyToken: event.canReply && Boolean(config.channelAccessToken),
      allowPushFallback: false,
    });

    await dependencies.storeLineAiSuggestion({
      conversationId: conversation.id,
      lineMessageId: inboundMessage.id,
      intent: route.intent,
      suggestedReply: suggestion.suggestedReply,
      confidence: suggestion.confidence,
      matchedProducts: suggestion.matchedProducts ? JSON.parse(JSON.stringify(suggestion.matchedProducts)) : null,
      reasoningSummary: suggestion.reasoningSummary,
      status: sendDecision.action === "send" ? LineAiSuggestionStatus.SENT : LineAiSuggestionStatus.DRAFT,
      deliveryMode: sendDecision.deliveryMode,
      sentAt: sendDecision.action === "send" ? new Date() : null,
    });

    await dependencies.storeLineAiAudit({
      conversationId: conversation.id,
      action: "AI_SEND_DECISION",
      payload: {
        lineEventId: event.lineEventId,
        action: sendDecision.action,
        deliveryMode: sendDecision.deliveryMode,
        reason: sendDecision.reason,
      },
    });

    if (
      sendDecision.action === "send" &&
      sendDecision.deliveryMode === LineDeliveryMode.REPLY &&
      event.replyToken &&
      config.channelAccessToken
    ) {
      const outboundMessage = await dependencies.appendLineMessage({
        conversationId: conversation.id,
        lineUserId: event.lineUserId,
        direction: LineMessageDirection.OUTBOUND_AI,
        messageType: event.messageType,
        intent: route.intent,
        text: suggestion.suggestedReply,
        deliveryMode: LineDeliveryMode.REPLY,
        deliveryStatus: LineDeliveryStatus.PENDING,
      });

      await dependencies.replyLineMessage({
        channelAccessToken: config.channelAccessToken,
        replyToken: event.replyToken,
        messages: [textMessage(suggestion.suggestedReply)],
      });

      await dependencies.markOutboundLineMessageSent({
        messageId: outboundMessage.id,
        deliveryMode: LineDeliveryMode.REPLY,
      });
      result.repliedCount += 1;
    }

    if (sendDecision.action === "handoff") {
      await dependencies.updateLineConversationState(
        conversation.id,
        buildLineConversationStatePatch({
          type: "waiting_admin",
          at: new Date(),
          reason: sendDecision.reason,
        }),
      );
    }

    result.processedCount += 1;
  }

  return result;
}
