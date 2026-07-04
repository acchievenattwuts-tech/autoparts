import { LineAiConfidence, LineConversationAiStatus, LineDeliveryMode, LineIntent } from "@/lib/generated/prisma";
import type { LineSendDecision } from "@/lib/line-conversation-types";
import type { ChatIntentRouteResult } from "@/lib/chat-core/intent-router";

export type LineAiPolicyInput = {
  autoReplyEnabled: boolean;
  dryRun: boolean;
  conversationStatus: LineConversationAiStatus;
  route: ChatIntentRouteResult;
  confidence: LineAiConfidence;
  hasReplyToken: boolean;
  allowPushFallback?: boolean;
};

const ADMIN_ONLY_INTENTS = new Set<LineIntent>([
  LineIntent.PAYMENT_SLIP_IMAGE,
  LineIntent.SHIPPING_ADDRESS,
  LineIntent.ORDER_STATUS,
  LineIntent.PRICE_NEGOTIATION,
  LineIntent.CLAIM_OR_RETURN,
  LineIntent.UNKNOWN,
]);

function blockedByConversationStatus(status: LineConversationAiStatus) {
  return (
    status === LineConversationAiStatus.PAUSED_BY_ADMIN ||
    status === LineConversationAiStatus.WAITING_ADMIN ||
    status === LineConversationAiStatus.CLOSED
  );
}

function resolveDeliveryMode(input: LineAiPolicyInput) {
  if (input.hasReplyToken) return LineDeliveryMode.REPLY;
  if (input.allowPushFallback) return LineDeliveryMode.PUSH;
  return LineDeliveryMode.NONE;
}

export function resolveLineAiSendDecision(input: LineAiPolicyInput): LineSendDecision {
  if (!input.autoReplyEnabled) {
    return {
      action: "store_only",
      deliveryMode: LineDeliveryMode.NONE,
      reason: "AUTO_REPLY_DISABLED",
    };
  }

  if (input.dryRun) {
    return {
      action: "store_only",
      deliveryMode: LineDeliveryMode.NONE,
      reason: "DRY_RUN",
    };
  }

  if (blockedByConversationStatus(input.conversationStatus)) {
    return {
      action: "store_only",
      deliveryMode: LineDeliveryMode.NONE,
      reason: `CONVERSATION_${input.conversationStatus}`,
    };
  }

  if (input.route.requiresAdmin || ADMIN_ONLY_INTENTS.has(input.route.intent)) {
    return {
      action: "handoff",
      deliveryMode: LineDeliveryMode.NONE,
      reason: `ADMIN_REQUIRED_${input.route.intent}`,
    };
  }

  if (input.confidence === LineAiConfidence.ADMIN_REQUIRED || input.confidence === LineAiConfidence.NOT_FOUND) {
    return {
      action: "handoff",
      deliveryMode: LineDeliveryMode.NONE,
      reason: `CONFIDENCE_${input.confidence}`,
    };
  }

  const deliveryMode = resolveDeliveryMode(input);
  if (deliveryMode === LineDeliveryMode.NONE) {
    return {
      action: "store_only",
      deliveryMode,
      reason: "NO_DELIVERY_TOKEN_OR_FALLBACK",
    };
  }

  if (input.confidence === LineAiConfidence.NEED_MORE_INFO) {
    return {
      action: "send",
      deliveryMode,
      reason: "ASK_MORE_INFO",
    };
  }

  return {
    action: "send",
    deliveryMode,
    reason: `CONFIDENCE_${input.confidence}`,
  };
}
