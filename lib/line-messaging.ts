const LINE_PUSH_API_URL = "https://api.line.me/v2/bot/message/push";

export type LineDailySummaryConfig = {
  channelAccessToken: string | null;
  cronSecret: string | null;
  recipientIds: string[];
  missingDeliveryEnv: string[];
};

export type LinePushResult = {
  sentCount: number;
  recipientIds: string[];
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
  const cronSecret = normalizeEnv(process.env.CRON_SECRET);
  const recipientIds = parseRecipientIds(
    process.env.LINE_DAILY_SUMMARY_TO_IDS ?? process.env.LINE_DAILY_SUMMARY_TO
  );

  const missingDeliveryEnv: string[] = [];

  if (!channelAccessToken) {
    missingDeliveryEnv.push("LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN");
  }

  if (recipientIds.length === 0) {
    missingDeliveryEnv.push("LINE_DAILY_SUMMARY_TO_IDS");
  }

  return {
    channelAccessToken,
    cronSecret,
    recipientIds,
    missingDeliveryEnv,
  };
}

export async function pushLineTextMessage(params: {
  channelAccessToken: string;
  recipientIds: string[];
  text: string;
}): Promise<LinePushResult> {
  const { channelAccessToken, recipientIds, text } = params;

  for (const recipientId of recipientIds) {
    const response = await fetch(LINE_PUSH_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: recipientId,
        messages: [
          {
            type: "text",
            text,
          },
        ],
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
