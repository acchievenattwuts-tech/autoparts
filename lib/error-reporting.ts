import { after } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { getTelegramConfig, sendTelegramMessage } from "@/lib/telegram";
import { formatDateTimeThai } from "@/lib/th-date";

/**
 * Alerting for failures that cost real money or real time if nobody notices.
 *
 * The shop had no error monitoring at all: 46 catch blocks handed the user
 * "เกิดข้อผิดพลาด กรุณาลองใหม่" and kept no record of why, and warranty-claims
 * logged nothing whatsoever across 14 catch blocks. Vercel's runtime logs have
 * no alerting, so a failing document save was invisible until a customer
 * complained.
 *
 * This routes those failures to the Telegram channel the shop already watches,
 * reusing lib/telegram.ts (retries, 429 handling) rather than adding a vendor.
 * Deliberately NOT a general logger: `console.error` stays the record of every
 * error, and only the expensive-to-miss paths call this.
 *
 * Three properties matter more than completeness here:
 *
 *  1. It can never break the flow it reports on. Every failure inside is
 *     swallowed — an alert that takes down a sale is worse than no alert.
 *  2. It can never flood. An alert nobody reads is worse than none at all, so
 *     identical failures collapse into one message per cooldown window.
 *  3. It carries no free-form payload. Only a fixed set of identifiers is sent,
 *     so a request body full of customer names and addresses cannot leak into
 *     a chat channel by accident.
 */

/** One alert per signature per window. Long enough that a failing endpoint
 *  hit repeatedly produces a handful of messages an hour, not hundreds. */
const ALERT_COOLDOWN_MS = 15 * 60_000;
const MAX_MESSAGE_CHARS = 400;

export type CriticalErrorContext = {
  /** Stable dotted path for the operation, e.g. "sales.create". Forms the
   *  first half of the alert signature, so keep it constant per call site. */
  scope: string;
  /** Document number, when the failure concerns one. */
  docNo?: string | null;
  /** Primary key of the affected record, when there is one. */
  entityId?: string | null;
  /** Who triggered it. An id only — never a name, which would be PII. */
  userId?: string | null;
};

export type ErrorSummary = { name: string; message: string };

/** Pull a name/message out of anything a `catch` can receive. */
export const summarizeError = (error: unknown): ErrorSummary => {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: (error.message || "").slice(0, MAX_MESSAGE_CHARS),
    };
  }
  if (typeof error === "string") {
    return { name: "Error", message: error.slice(0, MAX_MESSAGE_CHARS) };
  }
  return { name: "UnknownError", message: "" };
};

/**
 * Strip the parts of a message that differ between occurrences of the SAME
 * bug — ids, document numbers, timestamps, bare numbers. Without this, every
 * failed sale carries a different docNo, produces a different signature, and
 * defeats the cooldown entirely.
 */
export const normalizeErrorMessage = (message: string): string =>
  message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<time>")
    .replace(/\b[A-Z]{2,4}\d{8,}\b/g, "<docno>")
    .replace(/\b\d{3,}\b/g, "<n>")
    .trim();

/**
 * Grouping key for the cooldown. Same bug in the same place → same signature,
 * regardless of which document tripped it.
 */
export const buildErrorSignature = (scope: string, error: unknown): string => {
  const { name, message } = summarizeError(error);
  return `${scope}|${name}|${normalizeErrorMessage(message).slice(0, 120)}`;
};

/** The alert text. Plain text: lib/telegram.ts sends without a parse_mode, so
 *  an error message containing < or * needs no escaping and cannot break the
 *  send — which is exactly when an alert must not fail. */
export const buildCriticalErrorText = (params: {
  context: CriticalErrorContext;
  error: unknown;
  at: Date;
  appBaseUrl?: string | null;
}): string => {
  const { name, message } = summarizeError(params.error);
  const { context } = params;

  const lines: (string | null)[] = [
    "🚨 ระบบทำงานผิดพลาด",
    "━━━━━━━━━━━━━━━",
    `จุดที่เกิด: ${context.scope}`,
    context.docNo ? `เลขที่เอกสาร: ${context.docNo}` : null,
    context.entityId ? `รหัสอ้างอิง: ${context.entityId}` : null,
    context.userId ? `ผู้ใช้: ${context.userId}` : null,
    `เวลา: ${formatDateTimeThai(params.at)}`,
    "",
    `${name}: ${message || "(ไม่มีรายละเอียด)"}`,
    "",
    "ดูรายละเอียดเต็มได้ใน Vercel logs",
  ];

  return lines.filter((line) => line !== null).join("\n");
};

/**
 * True when this signature has not alerted inside the cooldown window.
 * Failures are treated as "allow": missing an alert because the throttle table
 * hiccuped is worse than sending one extra.
 */
const shouldSendAlert = async (signature: string): Promise<boolean> => {
  try {
    const rate = await checkRateLimit({
      key: `error-alert:${signature}`,
      limit: 1,
      windowMs: ALERT_COOLDOWN_MS,
    });
    return rate.ok;
  } catch {
    return true;
  }
};

const dispatchAlert = async (
  context: CriticalErrorContext,
  error: unknown,
): Promise<void> => {
  try {
    const { botToken, chatIds } = getTelegramConfig();
    // Same contract as every other Telegram path: unconfigured is not an error,
    // it just means this deployment has no chat to alert.
    if (!botToken || chatIds.length === 0) return;

    if (!(await shouldSendAlert(buildErrorSignature(context.scope, error)))) return;

    const text = buildCriticalErrorText({ context, error, at: new Date() });
    await Promise.all(
      chatIds.map((chatId) =>
        sendTelegramMessage({ botToken, chatId, text }).catch((sendError) => {
          console.error("[error-reporting] Telegram alert failed", sendError);
        }),
      ),
    );
  } catch (reportingError) {
    // Never let the reporter become the incident.
    console.error("[error-reporting] failed to dispatch alert", reportingError);
  }
};

/**
 * Log a failure and alert the shop about it.
 *
 * Always writes `console.error` first — the server log stays the complete
 * record, and the Telegram message is only a prompt to go look at it. Returns
 * immediately: the send is queued with `after()` so an error response is never
 * held up by an outbound HTTP call. Outside a request scope (cron, scripts)
 * `after()` is unavailable, so the send is awaited instead.
 */
export async function reportCriticalError(
  error: unknown,
  context: CriticalErrorContext,
): Promise<void> {
  console.error(`[${context.scope}] failed`, {
    docNo: context.docNo ?? undefined,
    entityId: context.entityId ?? undefined,
    userId: context.userId ?? undefined,
    error,
  });

  try {
    after(() => dispatchAlert(context, error));
  } catch {
    await dispatchAlert(context, error);
  }
}
