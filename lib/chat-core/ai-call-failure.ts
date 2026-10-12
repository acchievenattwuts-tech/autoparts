/**
 * Why a chat-turn Gemini call produced nothing usable. Every chat call falls back
 * silently (template reply / rule-based routing), so without this record an
 * outage could only be inferred from timings — the 2026-10-09 incident could not
 * be confirmed from the logs. Callers pass a listener; LINE and Messenger store
 * each failure as an `AI_GEMINI_CALL_FAILED` audit row.
 */

export const CHAT_AI_CALL_FAILED_AUDIT_ACTION = "AI_GEMINI_CALL_FAILED";

/** classify = intent/search classifier, reply = product reply, scoped_reply = smalltalk/out-of-scope reply. */
export type ChatAiCallStage = "classify" | "reply" | "scoped_reply";

export type ChatAiFailureKind =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "KEY_REJECTED"
  | "KEYS_UNAVAILABLE"
  | "NO_KEYS"
  | "REQUEST_ERROR"
  | "NETWORK"
  | "EMPTY_REPLY"
  | "UNPARSEABLE"
  | "UNKNOWN";

export type ChatAiCallFailure = {
  stage: ChatAiCallStage;
  kind: ChatAiFailureKind;
  /** Short error text with any API key redacted; null when there was no error object. */
  detail: string | null;
  durationMs: number;
};

export type ChatAiFailureListener = (failure: ChatAiCallFailure) => void;

const MAX_DETAIL_LENGTH = 160;

function redactSecrets(message: string): string {
  return message.replace(/key=[^&\s"']+/gi, "key=[redacted]").replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]");
}

/**
 * Maps an error thrown by `generateGeminiContent` to a failure kind. Reads the
 * message text the client builds (`ALL_GEMINI_KEYS_FAILED:<last error>`,
 * `GEMINI_HTTP_<status>:…`) and the abort error a timed-out fetch throws.
 */
export function classifyChatAiError(error: unknown): { kind: ChatAiFailureKind; detail: string | null } {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const detail = message ? redactSecrets(message).slice(0, MAX_DETAIL_LENGTH) : null;

  const kind: ChatAiFailureKind =
    message.includes("NO_GEMINI_KEYS_CONFIGURED")
      ? "NO_KEYS"
      : message.includes("ALL_GEMINI_KEYS_COOLING_DOWN_OR_DISABLED")
        ? "KEYS_UNAVAILABLE"
        : message.includes("GEMINI_REQUEST_ERROR")
          ? "REQUEST_ERROR"
          : // HTTP statuses first: a 5xx body may itself say "timeout".
            /GEMINI_HTTP_429/.test(message)
            ? "RATE_LIMITED"
            : /GEMINI_HTTP_5\d\d/.test(message)
              ? "SERVER_ERROR"
              : /GEMINI_HTTP_40[13]/.test(message)
                ? "KEY_REJECTED"
                : name === "AbortError" || /aborted|timed? ?out/i.test(message)
                  ? "TIMEOUT"
                  : /fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket/i.test(message)
                    ? "NETWORK"
                    : "UNKNOWN";

  return { kind, detail };
}

/** Calls the listener without ever letting telemetry break a customer reply. */
export function reportChatAiFailure(
  listener: ChatAiFailureListener | undefined,
  failure: ChatAiCallFailure,
): void {
  if (!listener) return;
  try {
    listener(failure);
  } catch {
    // Observability must never affect the reply.
  }
}
