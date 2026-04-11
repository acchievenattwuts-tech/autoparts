export const dynamic = "force-dynamic";

import {
  fetchLineUserProfile,
  getLineDailySummaryConfig,
  verifyLineWebhookSignature,
} from "@/lib/line-messaging";
import { upsertLineRecipientFromWebhook } from "@/lib/line-recipient";

type LineWebhookEvent = {
  type?: string;
  source?: {
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
};

export async function POST(request: Request) {
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
  let capturedCount = 0;

  for (const event of events) {
    const source = event.source;
    if (!source) {
      continue;
    }

    let displayName: string | null = null;
    if (source.userId && config.channelAccessToken) {
      try {
        const profile = await fetchLineUserProfile({
          channelAccessToken: config.channelAccessToken,
          userId: source.userId,
        });
        displayName = profile?.displayName ?? null;
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

    if (saved.length > 0) {
      capturedCount += saved.length;
    }
  }

  return Response.json({ ok: true, capturedCount });
}

export async function GET() {
  return Response.json({ ok: true, route: "LINE webhook" });
}
