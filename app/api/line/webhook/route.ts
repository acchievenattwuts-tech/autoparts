export const dynamic = "force-dynamic";

import {
  fetchLineUserProfile,
  getLineDailySummaryConfig,
  verifyLineWebhookSignature,
} from "@/lib/line-messaging";
import { getLineAiSettings } from "@/lib/line-ai-settings";
import { upsertLineRecipientFromWebhook } from "@/lib/line-recipient";
import { processLineWebhookPayload } from "@/lib/line-webhook-processor";

type LineWebhookEvent = {
  type?: string;
  source?: {
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
};

type CapturedLineRecipient = {
  savedCount: number;
  lineUserId: string | null;
  displayName: string | null;
  pictureUrl: string | null;
};

async function captureLineRecipientFromEvent(event: LineWebhookEvent, config: ReturnType<typeof getLineDailySummaryConfig>) {
  const source = event.source;
  if (!source) {
    return {
      savedCount: 0,
      lineUserId: null,
      displayName: null,
      pictureUrl: null,
    } satisfies CapturedLineRecipient;
  }

  let displayName: string | null = null;
  let pictureUrl: string | null = null;
  if (source.userId && config.channelAccessToken) {
    try {
      const profile = await fetchLineUserProfile({
        channelAccessToken: config.channelAccessToken,
        userId: source.userId,
      });
      displayName = profile?.displayName ?? null;
      pictureUrl = profile?.pictureUrl ?? null;
    } catch (error) {
      console.warn(
        `[line-webhook] profile lookup failed for ${source.userId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  const saved = await upsertLineRecipientFromWebhook({
    userId: source.userId ?? null,
    groupId: source.groupId ?? null,
    roomId: source.roomId ?? null,
    eventType: event.type ?? null,
    displayName,
  });

  return {
    savedCount: saved.length,
    lineUserId: source.userId ?? null,
    displayName,
    pictureUrl,
  } satisfies CapturedLineRecipient;
}

export async function POST(request: Request) {
  const receivedAt = new Date();
  const config = getLineDailySummaryConfig();
  if (!config.channelSecret) {
    return Response.json(
      { ok: false, error: "LINE_MESSAGING_API_CHANNEL_SECRET is not configured" },
      { status: 503 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineWebhookSignature({ channelSecret: config.channelSecret, body, signature })) {
    return Response.json({ ok: false, error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  let payload: { events?: LineWebhookEvent[] };
  try {
    payload = JSON.parse(body) as { events?: LineWebhookEvent[] };
  } catch {
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const events = payload.events ?? [];
  const capturedRecipients = await Promise.all(events.map((event) => captureLineRecipientFromEvent(event, config)));
  const capturedCount = capturedRecipients.reduce((sum, recipient) => sum + recipient.savedCount, 0);
  const lineProfilesByUserId = Object.fromEntries(
    capturedRecipients
      .filter((recipient) => recipient.lineUserId && (recipient.displayName || recipient.pictureUrl))
      .map((recipient) => [
        recipient.lineUserId as string,
        { displayName: recipient.displayName, pictureUrl: recipient.pictureUrl },
      ]),
  );

  let aiAgentResult: Awaited<ReturnType<typeof processLineWebhookPayload>> | null = null;
  try {
    const aiSettings = await getLineAiSettings();
    aiAgentResult = await processLineWebhookPayload(payload, {
      channelAccessToken: config.channelAccessToken,
      autoReplyEnabled: aiSettings.autoReplyEnabled,
      dryRun: aiSettings.dryRun,
      imageSearchEnabled: aiSettings.imageSearchEnabled,
      lineProfilesByUserId,
      allowPushFallback: true,
      receivedAt,
      replyTokenMaxAgeMs: 45_000,
    });
  } catch (error) {
    console.error("[line-webhook] AI agent processing failed", error);
  }

  return Response.json({ ok: true, capturedCount, aiAgentResult });
}

export async function GET() {
  return Response.json({ ok: true, route: "LINE webhook" });
}
