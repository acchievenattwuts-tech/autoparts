import { getQStashClient, getQStashConfig, getQStashReceiver } from "@/lib/qstash";

const LINE_DAILY_SUMMARY_ROUTE_PATH = "/api/internal/line-daily-summary";
export const LINE_DAILY_SUMMARY_QSTASH_SCHEDULE_ID = "line-daily-summary";

function normalizeBaseUrl(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getLineDailySummaryQStashStatus() {
  const config = getQStashConfig();

  return {
    ready: config.ready,
    appBaseUrlReady: Boolean(config.appBaseUrl),
    qstashUrlReady: Boolean(config.qstashUrl),
    qstashTokenReady: Boolean(config.qstashToken),
    qstashSigningKeysReady: Boolean(config.qstashCurrentSigningKey && config.qstashNextSigningKey),
  };
}

export function buildLineDailySummaryDestinationUrl() {
  const { appBaseUrl } = getQStashConfig();
  if (!appBaseUrl) {
    throw new Error("APP_BASE_URL_NOT_CONFIGURED");
  }

  return `${normalizeBaseUrl(appBaseUrl)}${LINE_DAILY_SUMMARY_ROUTE_PATH}`;
}

export function getLineDailySummaryQStashCron(sendTime: string) {
  const [hourText, minuteText] = sendTime.split(":");
  const bangkokHour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isInteger(bangkokHour) || !Number.isInteger(minute)) {
    throw new Error("INVALID_SEND_TIME");
  }

  // Bangkok is fixed at UTC+7, so we can keep the QStash cron in UTC without DST drift.
  const utcHour = (bangkokHour - 7 + 24) % 24;
  return `${minute} ${utcHour} * * *`;
}

function getQStashMissingConfig() {
  const { appBaseUrl, qstashUrl, qstashToken, qstashCurrentSigningKey, qstashNextSigningKey } = getQStashConfig();
  const missing: string[] = [];

  if (!appBaseUrl) missing.push("APP_BASE_URL");
  if (!qstashUrl) missing.push("QSTASH_URL");
  if (!qstashToken) missing.push("QSTASH_TOKEN");
  if (!qstashCurrentSigningKey) missing.push("QSTASH_CURRENT_SIGNING_KEY");
  if (!qstashNextSigningKey) missing.push("QSTASH_NEXT_SIGNING_KEY");

  return missing;
}

export async function syncLineDailySummaryQStashSchedule(params: {
  enabled: boolean;
  sendTime: string;
}) {
  const missing = getQStashMissingConfig();
  if (missing.length > 0) {
    throw new Error(`QSTASH_CONFIG_INCOMPLETE:${missing.join(",")}`);
  }

  const client = getQStashClient();

  if (!params.enabled) {
    try {
      await client.schedules.delete(LINE_DAILY_SUMMARY_QSTASH_SCHEDULE_ID);
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number }).status : undefined;
      if (status !== 404) {
        throw error;
      }
    }
    return { action: "deleted" as const };
  }

  const destination = buildLineDailySummaryDestinationUrl();
  const cron = getLineDailySummaryQStashCron(params.sendTime);

  await client.schedules.create({
    scheduleId: LINE_DAILY_SUMMARY_QSTASH_SCHEDULE_ID,
    destination,
    cron,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "LINE_DAILY_SUMMARY_QSTASH",
    }),
    retries: 3,
    label: "line-daily-summary",
  });

  return { action: "upserted" as const, cron };
}

export async function verifyLineDailySummaryQStashSignature(params: {
  signature: string;
  body: string;
  url: string;
}) {
  const receiver = getQStashReceiver();
  return receiver.verify(params);
}
