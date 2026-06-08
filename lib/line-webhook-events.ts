import { LineMessageType } from "@/lib/generated/prisma";

type LineWebhookSource = {
  userId?: string;
  groupId?: string;
  roomId?: string;
  type?: string;
};

type LineWebhookMessage = {
  id?: string;
  type?: string;
  text?: string;
};

type LineWebhookEvent = {
  type?: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: LineWebhookSource;
  message?: LineWebhookMessage;
  postback?: {
    data?: string;
  };
};

export type NormalizedLineWebhookEvent = {
  lineEventId: string | null;
  replyToken: string | null;
  sourceType: string | null;
  lineUserId: string | null;
  groupId: string | null;
  roomId: string | null;
  eventType: string;
  messageType: LineMessageType;
  lineMessageId: string | null;
  text: string | null;
  rawEvent: LineWebhookEvent;
  canReply: boolean;
};

function normalizeMessageType(event: LineWebhookEvent): LineMessageType {
  if (event.type === "follow") return LineMessageType.FOLLOW;
  if (event.type === "postback") return LineMessageType.POSTBACK;

  switch (event.message?.type) {
    case "text":
      return LineMessageType.TEXT;
    case "image":
      return LineMessageType.IMAGE;
    case "sticker":
      return LineMessageType.STICKER;
    default:
      return LineMessageType.UNKNOWN;
  }
}

function normalizeText(event: LineWebhookEvent, messageType: LineMessageType) {
  if (messageType === LineMessageType.TEXT) {
    const text = event.message?.text?.trim();
    return text ? text : null;
  }

  if (messageType === LineMessageType.POSTBACK) {
    const data = event.postback?.data?.trim();
    return data ? data : null;
  }

  return null;
}

export function normalizeLineWebhookEvents(payload: { events?: LineWebhookEvent[] }): NormalizedLineWebhookEvent[] {
  return (payload.events ?? [])
    .map((event): NormalizedLineWebhookEvent | null => {
      const source = event.source;
      if (!source) return null;

      const messageType = normalizeMessageType(event);
      const replyToken = event.replyToken?.trim() || null;

      return {
        lineEventId: event.webhookEventId?.trim() || event.message?.id?.trim() || null,
        replyToken,
        sourceType: source.type?.trim() || null,
        lineUserId: source.userId?.trim() || null,
        groupId: source.groupId?.trim() || null,
        roomId: source.roomId?.trim() || null,
        eventType: event.type?.trim() || "unknown",
        messageType,
        lineMessageId: event.message?.id?.trim() || null,
        text: normalizeText(event, messageType),
        rawEvent: event,
        canReply: Boolean(replyToken),
      };
    })
    .filter((event): event is NormalizedLineWebhookEvent => event !== null);
}
