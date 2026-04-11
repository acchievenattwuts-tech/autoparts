import { createHmac, timingSafeEqual } from "node:crypto";
import { LineDailySummaryTargetMode, LineRecipientType } from "@/lib/generated/prisma";
import type { LinePushMessage } from "@/lib/line-daily-summary";
import { resolveLineDailySummaryRecipientIds } from "@/lib/line-recipient";

const LINE_PUSH_API_URL = "https://api.line.me/v2/bot/message/push";

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

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LINE push failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }

  return {
    sentCount: recipientIds.length,
    recipientIds,
  };
}
