import { LineDailySummaryTargetMode } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { getBangkokDayKey } from "@/lib/storefront-visitor";

const BANGKOK_TIMEZONE = "Asia/Bangkok";

const SETTING_KEYS = {
  enabled: "line_daily_summary_enabled",
  sendTime: "line_daily_summary_send_time",
  targetMode: "line_daily_summary_target_mode",
  lastSentDayKey: "line_daily_summary_last_sent_day_key",
  lastSentAt: "line_daily_summary_last_sent_at",
} as const;

export type LineDailySummarySettings = {
  enabled: boolean;
  sendTime: string;
  targetMode: LineDailySummaryTargetMode;
  lastSentDayKey: string | null;
  lastSentAt: string | null;
};

export type LineDailySummaryScheduleCheck =
  | {
      ok: false;
      reason: "DISABLED" | "ALREADY_SENT" | "TOO_EARLY";
    }
  | {
      ok: true;
      reason: "READY";
      reportDayKey: string;
    };

export const defaultLineDailySummarySettings: LineDailySummarySettings = {
  enabled: true,
  sendTime: "19:30",
  targetMode: LineDailySummaryTargetMode.ENV_IDS,
  lastSentDayKey: null,
  lastSentAt: null,
};

function normalizeBoolean(value: string | undefined) {
  return value === "true";
}

export function isValidLineSummarySendTime(value: string | undefined): value is string {
  return !!value && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function normalizeTargetMode(value: string | undefined): LineDailySummaryTargetMode {
  return value === LineDailySummaryTargetMode.ADMIN_USERS
    ? LineDailySummaryTargetMode.ADMIN_USERS
    : defaultLineDailySummarySettings.targetMode;
}

export async function getLineDailySummarySettings(): Promise<LineDailySummarySettings> {
  const rows = await db.siteContent.findMany({
    where: {
      key: {
        in: Object.values(SETTING_KEYS),
      },
    },
  });

  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return {
    enabled:
      map[SETTING_KEYS.enabled] === undefined
        ? defaultLineDailySummarySettings.enabled
        : normalizeBoolean(map[SETTING_KEYS.enabled]),
    sendTime: isValidLineSummarySendTime(map[SETTING_KEYS.sendTime])
      ? map[SETTING_KEYS.sendTime]
      : defaultLineDailySummarySettings.sendTime,
    targetMode: normalizeTargetMode(map[SETTING_KEYS.targetMode]),
    lastSentDayKey: map[SETTING_KEYS.lastSentDayKey] ?? null,
    lastSentAt: map[SETTING_KEYS.lastSentAt] ?? null,
  };
}

export async function updateLineDailySummarySettings(input: {
  enabled: boolean;
  sendTime: string;
  targetMode: LineDailySummaryTargetMode;
}) {
  const entries: Array<[string, string]> = [
    [SETTING_KEYS.enabled, input.enabled ? "true" : "false"],
    [SETTING_KEYS.sendTime, input.sendTime],
    [SETTING_KEYS.targetMode, input.targetMode],
  ];

  for (const [key, value] of entries) {
    await db.siteContent.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}

export async function markLineDailySummarySent(reportDayKey: string, sentAt: Date) {
  const entries: Array<[string, string]> = [
    [SETTING_KEYS.lastSentDayKey, reportDayKey],
    [SETTING_KEYS.lastSentAt, sentAt.toISOString()],
  ];

  for (const [key, value] of entries) {
    await db.siteContent.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}

function getBangkokPart(date: Date, type: "hour" | "minute") {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: BANGKOK_TIMEZONE,
      hour12: false,
      [type]: "2-digit",
    })
      .formatToParts(date)
      .find((part) => part.type === type)?.value ?? "00"
  );
}

export function getBangkokMinutesOfDay(date: Date) {
  const hour = Number(getBangkokPart(date, "hour"));
  const minute = Number(getBangkokPart(date, "minute"));
  return hour * 60 + minute;
}

export function getSendTimeMinutes(sendTime: string) {
  const [hourText, minuteText] = sendTime.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

export function shouldSendLineDailySummaryNow(
  settings: LineDailySummarySettings,
  now: Date = new Date()
): LineDailySummaryScheduleCheck {
  if (!settings.enabled) {
    return { ok: false, reason: "DISABLED" as const };
  }

  const todayDayKey = getBangkokDayKey(now);
  if (settings.lastSentDayKey === todayDayKey) {
    return { ok: false, reason: "ALREADY_SENT" as const };
  }

  if (getBangkokMinutesOfDay(now) < getSendTimeMinutes(settings.sendTime)) {
    return { ok: false, reason: "TOO_EARLY" as const };
  }

  return { ok: true, reason: "READY" as const, reportDayKey: todayDayKey };
}
