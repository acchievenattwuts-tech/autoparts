export const dynamic = "force-dynamic";
// Mirrors the LINE webhook: ACK Meta immediately, run the AI pipeline in after()
// so a slow Gemini turn never makes Facebook retry-deliver the event.
export const maxDuration = 60;

import { reportCriticalError } from "@/lib/error-reporting";
import { after, type NextRequest } from "next/server";

import {
  getMessengerConfig,
  verifyMessengerSignature,
  verifyMessengerSubscription,
} from "@/lib/messenger/messenger-config";
import {
  processMessengerBatch,
  type MessengerInboundEvent,
} from "@/lib/messenger/messenger-webhook-processor";

type MessengerAttachment = {
  type?: string;
  payload?: { url?: string };
};

type MessengerMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    attachments?: MessengerAttachment[];
    is_echo?: boolean;
  };
};

type MessengerWebhookBody = {
  object?: string;
  entry?: Array<{ id?: string; messaging?: MessengerMessaging[] }>;
};

/** GET — Meta webhook verification handshake. */
export async function GET(request: NextRequest) {
  const { verifyToken } = getMessengerConfig();
  const params = request.nextUrl.searchParams;
  const challenge = verifyMessengerSubscription({
    mode: params.get("hub.mode"),
    token: params.get("hub.verify_token"),
    challenge: params.get("hub.challenge"),
    verifyToken,
  });

  if (challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** POST — inbound message events. Verify signature, ACK fast, process in after(). */
export async function POST(request: NextRequest) {
  const config = getMessengerConfig();

  // Raw body is required for the HMAC signature check — read once, parse manually.
  const rawBody = await request.text();
  const signatureOk = verifyMessengerSignature({
    appSecret: config.appSecret,
    rawBody,
    signatureHeader: request.headers.get("x-hub-signature-256"),
  });
  if (!signatureOk) {
    return new Response("Invalid signature", { status: 401 });
  }

  if (!config.pageAccessToken) {
    // Misconfigured — ACK so Meta doesn't retry, but do nothing.
    console.error(`[messenger-webhook] missing env: ${config.missingEnv.join(", ")}`);
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  let body: MessengerWebhookBody;
  try {
    body = JSON.parse(rawBody) as MessengerWebhookBody;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Only page-object webhooks carry Messenger messaging events.
  if (body.object !== "page") {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const events = extractInboundEvents(body);
  const pageAccessToken = config.pageAccessToken;

  after(async () => {
    try {
      await processMessengerBatch(events, { pageAccessToken });
    } catch (error) {
      // Same as the LINE webhook: this runs after the 200 has gone back to
      // Meta, so a failure here is invisible except that the customer never
      // gets a reply.
      await reportCriticalError(error, { scope: "messenger.webhook_processing" });
    }
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}

function extractInboundEvents(body: MessengerWebhookBody): MessengerInboundEvent[] {
  const events: MessengerInboundEvent[] = [];
  for (const entry of body.entry ?? []) {
    const pageId = entry.id ?? "";
    for (const messaging of entry.messaging ?? []) {
      const message = messaging.message;
      const psid = messaging.sender?.id;
      // Skip echoes (our own outbound), delivery/read receipts, and pageless events.
      if (!message || message.is_echo || !psid || !pageId) continue;

      const attachmentUrls = (message.attachments ?? [])
        .map((a) => a.payload?.url)
        .filter((url): url is string => Boolean(url));

      const text = message.text?.trim() || null;
      if (!text && attachmentUrls.length === 0) continue;

      events.push({
        pageId,
        psid,
        mid: message.mid ?? null,
        // mid is unique per message; use it as the idempotency key.
        fbEventId: message.mid ?? null,
        text,
        hasAttachment: attachmentUrls.length > 0,
        attachmentUrls,
      });
    }
  }
  return events;
}
