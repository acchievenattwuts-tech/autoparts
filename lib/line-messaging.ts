import { LineDailySummaryTargetMode, LineRecipientType } from "@/lib/generated/prisma";
import type { LinePushMessage } from "@/lib/line-daily-summary";
import { resolveLineDailySummaryRecipientIds } from "@/lib/line-recipient";
import { verifyLineWebhookSignature } from "@/lib/line-webhook-signature";

export { verifyLineWebhookSignature };

const LINE_PUSH_API_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_API_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PROFILE_API_URL = "https://api.line.me/v2/bot/profile";
const LINE_CONTENT_API_BASE = "https://api-data.line.me/v2/bot/message";
const MAX_LINE_CONTENT_BYTES = 6 * 1024 * 1024; // 6MB cap before base64 inlining to Gemini.
const LINE_PUSH_MAX_ATTEMPTS = 3;
const LINE_PUSH_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export type LineDailySummaryConfig = {
  channelAccessToken: string | null;
  channelSecret: string | null;
  envRecipientIds: string[];
  missingDeliveryEnv: string[];
};

export type LinePushResult = {
  sentCount: number;
  recipientIds: string[];
};

export type LineReplyResult = {
  sent: boolean;
  replyToken: string;
};

export type LineUserProfile = {
  displayName: string | null;
  pictureUrl: string | null;
  statusMessage: string | null;
};

type LinePushAttemptFailure = {
  attempt: number;
  status: number | null;
  body: string;
  retryable: boolean;
};

export type ResolvedLineRecipients = {
  mode: LineDailySummaryTargetMode;
  recipientIds: string[];
  recipients: Array<{
    userId: string | null;
    userName: string | null;
    recipientId: string | null;
    lineId: string;
    label: string;
    type: LineRecipientType;
  }>;
  missingDeliveryEnv: string[];
};

function normalizeEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseRecipientIds(value: string | undefined): string[] {
  const raw = normalizeEnv(value);
  if (!raw) return [];

  return [...new Set(raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}

export function getLineDailySummaryConfig(): LineDailySummaryConfig {
  const channelAccessToken = normalizeEnv(process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN);
  const channelSecret = normalizeEnv(process.env.LINE_MESSAGING_API_CHANNEL_SECRET);
  const envRecipientIds = parseRecipientIds(
    process.env.LINE_DAILY_SUMMARY_TO_IDS ?? process.env.LINE_DAILY_SUMMARY_TO
  );

  const missingDeliveryEnv: string[] = [];

  if (!channelAccessToken) {
    missingDeliveryEnv.push("LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN");
  }

  return {
    channelAccessToken,
    channelSecret,
    envRecipientIds,
    missingDeliveryEnv,
  };
}

export async function fetchLineUserProfile(params: {
  channelAccessToken: string;
  userId: string;
}): Promise<LineUserProfile | null> {
  const { channelAccessToken, userId } = params;

  const response = await fetch(`${LINE_PROFILE_API_URL}/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`LINE profile lookup failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    displayName?: string;
    pictureUrl?: string;
    statusMessage?: string;
  };

  return {
    displayName: payload.displayName?.trim() || null,
    pictureUrl: payload.pictureUrl?.trim() || null,
    statusMessage: payload.statusMessage?.trim() || null,
  };
}

export type LineMessageContent = {
  mimeType: string;
  dataBase64: string;
};

/**
 * Fetches a LINE message's binary content (e.g. an image) on demand via the
 * content API. LINE retains content only for a limited window, so callers must
 * use it immediately and persist any derived data they need. Returns null when
 * the content is gone (404/410); throws on other upstream failures.
 */
export async function fetchLineMessageContent(params: {
  channelAccessToken: string;
  messageId: string;
}): Promise<LineMessageContent | null> {
  const { channelAccessToken, messageId } = params;

  const response = await fetch(
    `${LINE_CONTENT_API_BASE}/${encodeURIComponent(messageId)}/content`,
    { headers: { Authorization: `Bearer ${channelAccessToken}` } },
  );

  if (response.status === 404 || response.status === 410) {
    return null;
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`LINE content fetch failed (${response.status}): ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_LINE_CONTENT_BYTES) {
    return null;
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return {
    mimeType,
    dataBase64: Buffer.from(arrayBuffer).toString("base64"),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number) {
  return attempt * 500;
}

function summarizeAttemptFailures(failures: LinePushAttemptFailure[]) {
  return failures
    .map((failure) => {
      const statusText = failure.status === null ? "network" : `${failure.status}`;
      return `attempt ${failure.attempt} (${statusText}): ${failure.body}`;
    })
    .join(" | ");
}

function isRetryableFetchStatus(status: number) {
  return LINE_PUSH_RETRYABLE_STATUS_CODES.has(status);
}

async function pushLineMessageWithRetry(params: {
  channelAccessToken: string;
  recipientId: string;
  messages: LinePushMessage[];
}) {
  const { channelAccessToken, recipientId, messages } = params;
  const failures: LinePushAttemptFailure[] = [];

  for (let attempt = 1; attempt <= LINE_PUSH_MAX_ATTEMPTS; attempt += 1) {
    try {
      console.info(
        `[line-daily-summary] push attempt ${attempt}/${LINE_PUSH_MAX_ATTEMPTS} -> ${recipientId}`
      );

      const response = await fetch(LINE_PUSH_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channelAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: recipientId,
          messages,
        }),
      });

      if (response.ok) {
        if (attempt > 1) {
          console.info(
            `[line-daily-summary] push recovered on attempt ${attempt}/${LINE_PUSH_MAX_ATTEMPTS} -> ${recipientId}`
          );
        }
        return;
      }

      const body = (await response.text()).slice(0, 300);
      const retryable = isRetryableFetchStatus(response.status);
      failures.push({
        attempt,
        status: response.status,
        body,
        retryable,
      });

      console.warn(
        `[line-daily-summary] push failed on attempt ${attempt}/${LINE_PUSH_MAX_ATTEMPTS} -> ${recipientId} (status ${response.status}, retryable=${retryable})`
      );

      if (!retryable || attempt === LINE_PUSH_MAX_ATTEMPTS) {
        throw new Error(
          `LINE push failed after ${attempt} attempt(s): ${summarizeAttemptFailures(failures)}`
        );
      }

      const delayMs = getRetryDelayMs(attempt);
      console.info(
        `[line-daily-summary] retrying in ${delayMs}ms -> ${recipientId}`
      );
      await sleep(delayMs);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("LINE push failed after")) {
        throw error;
      }

      const body = error instanceof Error ? error.message.slice(0, 300) : "Unknown network error";
      failures.push({
        attempt,
        status: null,
        body,
        retryable: true,
      });

      console.warn(
        `[line-daily-summary] network failure on attempt ${attempt}/${LINE_PUSH_MAX_ATTEMPTS} -> ${recipientId}`
      );

      if (attempt === LINE_PUSH_MAX_ATTEMPTS) {
        throw new Error(
          `LINE push failed after ${attempt} attempt(s): ${summarizeAttemptFailures(failures)}`
        );
      }

      const delayMs = getRetryDelayMs(attempt);
      console.info(
        `[line-daily-summary] retrying in ${delayMs}ms after network failure -> ${recipientId}`
      );
      await sleep(delayMs);
    }
  }
}

export async function resolveConfiguredLineRecipients(
  targetMode: LineDailySummaryTargetMode
): Promise<ResolvedLineRecipients> {
  const config = getLineDailySummaryConfig();

  if (targetMode === LineDailySummaryTargetMode.ADMIN_USERS) {
    const resolved = await resolveLineDailySummaryRecipientIds(targetMode);

    return {
      ...resolved,
      missingDeliveryEnv: resolved.recipientIds.length === 0 ? ["ADMIN_LINE_RECIPIENTS"] : [],
    };
  }

  return {
    mode: targetMode,
    recipientIds: config.envRecipientIds,
    recipients: config.envRecipientIds.map((lineId) => ({
      userId: null,
      userName: null,
      recipientId: null,
      lineId,
      label: lineId,
      type: lineId.startsWith("C")
        ? LineRecipientType.GROUP
        : lineId.startsWith("R")
          ? LineRecipientType.ROOM
          : LineRecipientType.USER,
    })),
    missingDeliveryEnv: config.envRecipientIds.length === 0 ? ["LINE_DAILY_SUMMARY_TO_IDS"] : [],
  };
}

export async function pushLineMessages(params: {
  channelAccessToken: string;
  recipientIds: string[];
  messages: LinePushMessage[];
}): Promise<LinePushResult> {
  const { channelAccessToken, recipientIds, messages } = params;

  for (const recipientId of recipientIds) {
    await pushLineMessageWithRetry({
      channelAccessToken,
      recipientId,
      messages,
    });
  }

  return {
    sentCount: recipientIds.length,
    recipientIds,
  };
}

export async function replyLineMessage(params: {
  channelAccessToken: string;
  replyToken: string;
  messages: LinePushMessage[];
}): Promise<LineReplyResult> {
  const { channelAccessToken, replyToken, messages } = params;

  const response = await fetch(LINE_REPLY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`LINE reply failed (${response.status}): ${body}`);
  }

  return {
    sent: true,
    replyToken,
  };
}
