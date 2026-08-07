export const dynamic = "force-dynamic";
// Coalescing runs in after(): debounce (3s) + AI pipeline (~10s) + abort-on-newer
// re-runs for slow typists can exceed the default budget. 60s matches the
// processing-lock lease so the owner can finish and reply before being killed.
export const maxDuration = 60;

import { reportCriticalError } from "@/lib/error-reporting";
import { after } from "next/server";

import {
  fetchLineUserProfile,
  getLineDailySummaryConfig,
  verifyLineWebhookSignature,
} from "@/lib/line-messaging";
import { getLineAiSettings } from "@/lib/line-ai-settings";
import { getLineConversationProfileSnapshot } from "@/lib/line-conversation-repository";
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

// How long a stored LINE profile stays "fresh": while the customer is active
// within this window the stored displayName/pictureUrl are reused instead of
// re-fetching from the LINE profile API on every inbound event.
const PROFILE_REFRESH_IDLE_MS = 24 * 60 * 60 * 1000;

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
    // Skip the LINE profile API round-trip when we already hold a fresh profile:
    // the conversation has a displayName and the customer was active within the
    // last 24h. A returning customer after an idle day (or a conversation with
    // no stored name yet) still refreshes from LINE as before, so display names
    // never go stale for long — they just stop costing an HTTP call per message.
    const snapshot = await getLineConversationProfileSnapshot(source.userId).catch(() => null);
    const profileFresh = Boolean(
      snapshot?.displayName &&
        snapshot.lastCustomerMessageAt &&
        Date.now() - snapshot.lastCustomerMessageAt.getTime() < PROFILE_REFRESH_IDLE_MS,
    );
    if (profileFresh && snapshot) {
      displayName = snapshot.displayName;
      pictureUrl = snapshot.pictureUrl;
    } else {
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

/**
 * Heavy webhook work: LINE profile lookups + the full AI pipeline (classify →
 * search → suggest → reply). Runs in the background via `after()` so the
 * webhook can ACK LINE within milliseconds — LINE re-delivers on a slow ACK,
 * and a slow ACK also burns the reply-token window. Every failure is swallowed
 * here (logged + admin-notified downstream); the cron worker
 * (`/api/line/ai-jobs/process`) is the failsafe for any job left PENDING if
 * this background promise crashes mid-flight.
 */
async function processWebhookInBackground(
  payload: { events?: LineWebhookEvent[] },
  config: ReturnType<typeof getLineDailySummaryConfig>,
  receivedAt: Date,
) {
  try {
    const events = payload.events ?? [];
    // Dedupe profile fetches: a single webhook payload often carries multiple
    // events from the same userId (e.g. a text + an image). Share one in-flight
    // LINE profile lookup per userId so we don't burn API quota.
    const profileCache = new Map<string, ReturnType<typeof captureLineRecipientFromEvent>>();
    const capturedRecipients = await Promise.all(
      events.map((event) => {
        const userId = event.source?.userId;
        if (!userId) return captureLineRecipientFromEvent(event, config);
        const cached = profileCache.get(userId);
        if (cached) return cached;
        const pending = captureLineRecipientFromEvent(event, config);
        profileCache.set(userId, pending);
        return pending;
      }),
    );
    const lineProfilesByUserId = Object.fromEntries(
      capturedRecipients
        .filter((recipient) => recipient.lineUserId && (recipient.displayName || recipient.pictureUrl))
        .map((recipient) => [
          recipient.lineUserId as string,
          { displayName: recipient.displayName, pictureUrl: recipient.pictureUrl },
        ]),
    );

    const aiSettings = await getLineAiSettings();
    await processLineWebhookPayload(payload, {
      channelAccessToken: config.channelAccessToken,
      autoReplyEnabled: aiSettings.autoReplyEnabled,
      dryRun: aiSettings.dryRun,
      imageSearchEnabled: aiSettings.imageSearchEnabled,
      lineProfilesByUserId,
      allowPushFallback: true,
      receivedAt,
      // LINE reply tokens are valid ~60s. Aim to land the reply inside that free
      // window even when image OCR ate part of the budget — 55s keeps a 5s margin
      // under the 60s serverless ceiling. If it still misses, delivery PUSHes the
      // result afterward (allowPushFallback) so the customer never loses the answer.
      replyTokenMaxAgeMs: 55_000,
      // Coalesce a burst of images/texts into ONE reply (debounce + abort-on-newer).
      coalesce: true,
      coalesceWindowMs: 3_000,
      coalesceLeaseMs: 60_000,
    });
  } catch (error) {
    // Runs in after(), so nothing surfaces to LINE or to the customer — the
    // webhook has already answered 200. Without an alert this is completely
    // silent: the customer just never gets a reply.
    await reportCriticalError(error, { scope: "line.webhook_processing" });
  }
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

  // ACK LINE immediately, then run profile lookups + the AI pipeline in the
  // background. `after()` keeps the serverless function alive until the
  // promise settles, so the reply token is still fresh when the pipeline runs.
  after(processWebhookInBackground(payload, config, receivedAt));

  return Response.json({ ok: true, accepted: payload.events?.length ?? 0 });
}

export async function GET() {
  return Response.json({ ok: true, route: "LINE webhook" });
}
