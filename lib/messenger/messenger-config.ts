import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Central config + webhook-security helpers for the Facebook Messenger channel.
 * The AI "brain" (search + suggestion) lives in lib/chat-core and is shared with
 * LINE; this module only owns Messenger-specific transport concerns.
 */

export const MESSENGER_GRAPH_API_VERSION = "v23.0";
export const MESSENGER_GRAPH_API_BASE = `https://graph.facebook.com/${MESSENGER_GRAPH_API_VERSION}`;

export type MessengerConfig = {
  pageId: string | null;
  pageAccessToken: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  missingEnv: string[];
};

function normalizeEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getMessengerConfig(): MessengerConfig {
  const pageId = normalizeEnv(process.env.MESSENGER_PAGE_ID);
  const pageAccessToken = normalizeEnv(process.env.MESSENGER_PAGE_ACCESS_TOKEN);
  const appSecret = normalizeEnv(process.env.MESSENGER_APP_SECRET);
  const verifyToken = normalizeEnv(process.env.MESSENGER_VERIFY_TOKEN);

  const missingEnv: string[] = [];
  if (!pageId) missingEnv.push("MESSENGER_PAGE_ID");
  if (!pageAccessToken) missingEnv.push("MESSENGER_PAGE_ACCESS_TOKEN");
  if (!appSecret) missingEnv.push("MESSENGER_APP_SECRET");
  if (!verifyToken) missingEnv.push("MESSENGER_VERIFY_TOKEN");

  return { pageId, pageAccessToken, appSecret, verifyToken, missingEnv };
}

/**
 * Validates the GET webhook verification handshake Meta performs when you first
 * register (or re-verify) the callback URL. Returns the echoed challenge string
 * when the mode + token match, otherwise null (caller should respond 403).
 */
export function verifyMessengerSubscription(params: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  verifyToken: string | null;
}): string | null {
  const { mode, token, challenge, verifyToken } = params;
  if (!verifyToken) return null;
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return challenge;
  }
  return null;
}

/**
 * Verifies the X-Hub-Signature-256 header Meta sends on every POST. The digest is
 * `sha256=<hex hmac of the RAW request body>` keyed by the app secret. Callers
 * MUST pass the exact raw body bytes (not a re-serialized JSON) or this fails.
 */
export function verifyMessengerSignature(params: {
  appSecret: string | null;
  rawBody: string;
  signatureHeader: string | null;
}): boolean {
  const { appSecret, rawBody, signatureHeader } = params;
  if (!appSecret || !signatureHeader) return false;

  const [algo, providedHex] = signatureHeader.split("=");
  if (algo !== "sha256" || !providedHex) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  // Length guard first — timingSafeEqual throws on unequal-length buffers.
  if (providedHex.length !== expectedHex.length) return false;

  try {
    return timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expectedHex, "hex"));
  } catch {
    return false;
  }
}
