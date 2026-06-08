import type {
  LineAiConfidence,
  LineAiJobStatus,
  LineAiJobType,
  LineAiSuggestionStatus,
  LineConversationAiStatus,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineIntent,
  LineMessageDirection,
  LineMessageType,
  PaymentSlipVerificationStatus,
} from "@/lib/generated/prisma";

export type {
  LineAiConfidence,
  LineAiJobStatus,
  LineAiJobType,
  LineAiSuggestionStatus,
  LineConversationAiStatus,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineIntent,
  LineMessageDirection,
  LineMessageType,
  PaymentSlipVerificationStatus,
};

export type LineSendDecision =
  | {
      action: "send";
      deliveryMode: LineDeliveryMode;
      reason: string;
    }
  | {
      action: "store_only";
      deliveryMode: LineDeliveryMode;
      reason: string;
    }
  | {
      action: "handoff";
      deliveryMode: LineDeliveryMode;
      reason: string;
    };

export type LineConversationStatePatch = {
  aiStatus?: LineConversationAiStatus;
  assignedAdminId?: string | null;
  pausedReason?: string | null;
  lastCustomerMessageAt?: Date;
  lastAdminMessageAt?: Date;
  pausedAt?: Date | null;
  resumedAt?: Date | null;
  closedAt?: Date | null;
};

export type LineConversationStateAction =
  | { type: "customer_message"; at: Date }
  | { type: "admin_message"; adminUserId: string; at: Date; pauseReason?: string }
  | { type: "pause"; adminUserId?: string | null; at: Date; reason?: string | null }
  | { type: "resume"; at: Date }
  | { type: "waiting_admin"; adminUserId?: string | null; at: Date; reason?: string | null }
  | { type: "close"; at: Date };
