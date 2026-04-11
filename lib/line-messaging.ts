import { createHmac, timingSafeEqual } from "node:crypto";
import { LineDailySummaryTargetMode, LineRecipientType } from "@/lib/generated/prisma";
import type { LinePushMessage } from "@/lib/line-daily-summary";
import { resolveLineDailySummaryRecipientIds } from "@/lib/line-recipient";

const LINE_PUSH_API_URL = "https://api.line.me/v2/bot/message/push";
const LINE_PROFILE_API_URL = "https://api.line.me/v2/bot/profile";
const LINE_PUSH_MAX_ATTEMPTS = 3;
const LINE_PUSH_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export type LineDailySummaryConfig = {
  channelAccessToken: string | null;
  channelSecret: string | null;
  cronSecret: string | null;
  envRecipientIds: string[];
  missingDeliveryEnv: string[];
};

export type LinePushResult = {
  sentCount: number;
  recipientIds: string[];
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
  const cronSecret = normalizeEnv(process.env.CRON_SECRET);
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
    cronSecret,
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

export function verifyLineWebhookSignature(params: {
  channelSecret: string;
  body: string;
  signature: string | null;
}) {
  const { channelSecret, body, signature } = params;

  if (!signature) {
    return false;
  }

  const expected = createHmac("sha256", channelSecret).update(body).digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
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
