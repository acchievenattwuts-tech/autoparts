/**
 * Deadline for reading the customer's images (Gemini vision) inside one chat
 * turn, shared by LINE and Messenger.
 *
 * The webhook function is killed at 60s. Everything after the image read
 * (intent classify, search, reply) needs about 20s in the worst case, so the read
 * has to end well before that. Normally it may run until 25s after the
 * customer's last message in the burst arrived (owner decision 2026-11-05: an
 * image sent mid-burst used to get only the 10s minimum, shorter than one 12s
 * vision attempt, so the fallback model never got a try). A read that starts
 * late still gets at least 10s. Neither may go past 38s from the budget start.
 *
 * A read that misses the deadline hands the turn to an admin instead of
 * answering without the image (owner decision 2026-11-05, after the 2026-11-04
 * incident where a hung model got six LINE webhooks in a row killed at 60s).
 */
export const IMAGE_READ_DEADLINE_MS = 25_000;
export const IMAGE_READ_MIN_WINDOW_MS = 10_000;
export const IMAGE_READ_HARD_CUTOFF_MS = 38_000;
/** After the hand-off, a read that is still running is awaited until this point
 *  (from the budget start), so a payment slip it finds is still captured. */
export const IMAGE_READ_LATE_GRACE_MS = 50_000;

export const IMAGE_READ_TIMEOUT_HANDOFF_REASON = "IMAGE_READ_TIMEOUT_HANDOFF";
export const IMAGE_READ_TIMEOUT_HANDOFF_AUDIT_ACTION = "AI_IMAGE_READ_TIMEOUT_HANDOFF";

/**
 * The instant (epoch ms) by which an image read must finish.
 * `budgetStartMs` is when the webhook received the first message (or when a
 * recovery run started); `lastMessageAtMs` is when the newest message of the
 * burst was stored (null when unknown); `readStartMs` is when the read begins.
 */
export function resolveImageReadDeadlineAt(input: {
  budgetStartMs: number;
  lastMessageAtMs: number | null;
  readStartMs: number;
}): number {
  const countFromMs =
    input.lastMessageAtMs !== null && Number.isFinite(input.lastMessageAtMs)
      ? Math.max(input.budgetStartMs, input.lastMessageAtMs)
      : input.budgetStartMs;
  const preferred = Math.max(countFromMs + IMAGE_READ_DEADLINE_MS, input.readStartMs + IMAGE_READ_MIN_WINDOW_MS);
  return Math.min(preferred, input.budgetStartMs + IMAGE_READ_HARD_CUTOFF_MS);
}

/** The instant (epoch ms) until which a late read is still awaited after the hand-off. */
export function resolveImageReadLateGraceUntil(budgetStartMs: number): number {
  return budgetStartMs + IMAGE_READ_LATE_GRACE_MS;
}

export type ImageReadRaceResult<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Waits for `task` until `deadlineAtMs`. A deadline already in the past times out
 * at once. The task is not cancelled on a timeout: the caller keeps it and may
 * wait for it again later. A rejected task rejects this call, so callers that
 * keep a task past the deadline must also handle its rejection.
 */
export async function raceImageReadDeadline<T>(
  task: Promise<T>,
  deadlineAtMs: number,
): Promise<ImageReadRaceResult<T>> {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) return { timedOut: true };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.then((value): ImageReadRaceResult<T> => ({ timedOut: false, value })),
      new Promise<ImageReadRaceResult<T>>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
