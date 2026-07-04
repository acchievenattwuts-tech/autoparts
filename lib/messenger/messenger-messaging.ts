import { MESSENGER_GRAPH_API_BASE } from "@/lib/messenger/messenger-config";

/**
 * Facebook Messenger Send API transport. Mirrors the role of lib/line-messaging
 * for the Messenger channel: send text / structured messages, sender actions
 * (typing indicator), fetch the sender profile, and pull inbound attachments.
 */

const SEND_API_MAX_ATTEMPTS = 3;
const SEND_API_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // cap before base64 inlining to Gemini

/**
 * Meta's messaging_type. RESPONSE is valid within the 24-hour standard messaging
 * window (i.e. replying to a user-initiated message). MESSAGE_TAG (with a tag) is
 * required once the window has closed; UPDATE is for proactive non-promotional.
 */
export type MessengerMessagingType = "RESPONSE" | "UPDATE" | "MESSAGE_TAG";

export type MessengerUserProfile = {
  firstName: string | null;
  lastName: string | null;
  profilePic: string | null;
};

export type MessengerAttachmentContent = {
  mimeType: string;
  dataBase64: string;
};

// ── Generic Template (product carousel — the Messenger analogue of LINE Flex) ──
export type MessengerButton = {
  type: "web_url" | "postback";
  title: string;
  url?: string;
  payload?: string;
};

export type MessengerGenericElement = {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  defaultActionUrl?: string;
  buttons?: MessengerButton[];
};

type SendApiMessage =
  | { text: string }
  | {
      attachment: {
        type: "template";
        payload: {
          template_type: "generic";
          elements: Array<{
            title: string;
            subtitle?: string;
            image_url?: string;
            default_action?: { type: "web_url"; url: string };
            buttons?: Array<{ type: string; title: string; url?: string; payload?: string }>;
          }>;
        };
      };
    };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callSendApi(params: {
  pageAccessToken: string;
  body: Record<string, unknown>;
}): Promise<void> {
  const { pageAccessToken, body } = params;
  const url = `${MESSENGER_GRAPH_API_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;

  const failures: string[] = [];
  for (let attempt = 1; attempt <= SEND_API_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) return;

      const text = (await response.text()).slice(0, 300);
      const retryable = SEND_API_RETRYABLE_STATUS.has(response.status);
      failures.push(`attempt ${attempt} (${response.status}): ${text}`);
      if (!retryable || attempt === SEND_API_MAX_ATTEMPTS) {
        throw new Error(`Messenger Send API failed: ${failures.join(" | ")}`);
      }
      await sleep(attempt * 500);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Messenger Send API failed")) {
        throw error;
      }
      failures.push(`attempt ${attempt} (network): ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
      if (attempt === SEND_API_MAX_ATTEMPTS) {
        throw new Error(`Messenger Send API failed: ${failures.join(" | ")}`);
      }
      await sleep(attempt * 500);
    }
  }
}

async function sendMessage(params: {
  pageAccessToken: string;
  psid: string;
  message: SendApiMessage;
  messagingType?: MessengerMessagingType;
  tag?: string;
}): Promise<void> {
  const { pageAccessToken, psid, message, messagingType = "RESPONSE", tag } = params;
  await callSendApi({
    pageAccessToken,
    body: {
      recipient: { id: psid },
      messaging_type: messagingType,
      ...(messagingType === "MESSAGE_TAG" && tag ? { tag } : {}),
      message,
    },
  });
}

export async function sendMessengerText(params: {
  pageAccessToken: string;
  psid: string;
  text: string;
  messagingType?: MessengerMessagingType;
  tag?: string;
}): Promise<void> {
  const { text, ...rest } = params;
  await sendMessage({ ...rest, message: { text } });
}

/** Sends a horizontal product carousel (generic template, max 10 elements). */
export async function sendMessengerGenericTemplate(params: {
  pageAccessToken: string;
  psid: string;
  elements: MessengerGenericElement[];
  messagingType?: MessengerMessagingType;
  tag?: string;
}): Promise<void> {
  const { elements, ...rest } = params;
  const capped = elements.slice(0, 10).map((el) => ({
    title: el.title.slice(0, 80),
    ...(el.subtitle ? { subtitle: el.subtitle.slice(0, 80) } : {}),
    ...(el.imageUrl ? { image_url: el.imageUrl } : {}),
    ...(el.defaultActionUrl ? { default_action: { type: "web_url" as const, url: el.defaultActionUrl } } : {}),
    ...(el.buttons && el.buttons.length > 0
      ? {
          buttons: el.buttons.slice(0, 3).map((b) =>
            b.type === "web_url"
              ? { type: "web_url", title: b.title.slice(0, 20), url: b.url ?? "" }
              : { type: "postback", title: b.title.slice(0, 20), payload: b.payload ?? "" },
          ),
        }
      : {}),
  }));

  await sendMessage({
    ...rest,
    message: {
      attachment: { type: "template", payload: { template_type: "generic", elements: capped } },
    },
  });
}

/** Best-effort typing indicator / mark-seen. Callers should swallow failures. */
export async function sendMessengerSenderAction(params: {
  pageAccessToken: string;
  psid: string;
  action: "typing_on" | "typing_off" | "mark_seen";
}): Promise<void> {
  const { pageAccessToken, psid, action } = params;
  await callSendApi({
    pageAccessToken,
    body: { recipient: { id: psid }, sender_action: action },
  });
}

export async function fetchMessengerUserProfile(params: {
  pageAccessToken: string;
  psid: string;
}): Promise<MessengerUserProfile | null> {
  const { pageAccessToken, psid } = params;
  const url = `${MESSENGER_GRAPH_API_BASE}/${encodeURIComponent(psid)}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(pageAccessToken)}`;

  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Messenger profile lookup failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    first_name?: string;
    last_name?: string;
    profile_pic?: string;
  };
  return {
    firstName: payload.first_name?.trim() || null,
    lastName: payload.last_name?.trim() || null,
    profilePic: payload.profile_pic?.trim() || null,
  };
}

/**
 * Downloads an inbound attachment (image / payment slip) from the Facebook CDN
 * URL supplied in the webhook payload. Returns null when the content is missing
 * or exceeds the size cap; throws on other upstream failures.
 */
export async function fetchMessengerAttachment(
  cdnUrl: string,
): Promise<MessengerAttachmentContent | null> {
  const response = await fetch(cdnUrl);
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Messenger attachment fetch failed (${response.status}): ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_ATTACHMENT_BYTES) {
    return null;
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return { mimeType, dataBase64: Buffer.from(arrayBuffer).toString("base64") };
}
