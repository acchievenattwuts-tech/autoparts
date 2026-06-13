import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * Conversation memory for the LINE AI, modelled the way task-oriented dialog
 * systems (Dialogflow CX session params, Rasa slots/forms, Lex session
 * attributes) keep context — NOT by dumping raw history into the prompt.
 *
 * Three levels:
 *  1. Session window — context only carries within an active session; a gap
 *     longer than {@link SESSION_IDLE_MS} starts a fresh session (old subject
 *     dropped). {@link boundMessagesToSession} / {@link isFrameStale}.
 *  2. Topic-shift reset — a NEW part type means a new inquiry; the part slot is
 *     replaced (the vehicle slots stay — the customer is usually on the same car).
 *  3. Slot frame — the current {partType, car, year} is the carried subject,
 *     merged across turns. {@link reconcileInquiryFrame}.
 */

/** Idle gap that ends a conversation session (30 min — the GA/analytics norm;
 *  Lex defaults to 5 min, Rasa to 60 min — 30 balances continuity vs staleness). */
export const SESSION_IDLE_MS = 30 * 60_000;

export type InquiryFrame = {
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
};

export const EMPTY_INQUIRY_FRAME: InquiryFrame = {
  partType: null,
  carBrand: null,
  carModel: null,
  year: null,
};

function isFrameEmpty(frame: InquiryFrame | null | undefined): boolean {
  return (
    !frame ||
    (!frame.partType && !frame.carBrand && !frame.carModel && (frame.year === null || frame.year === undefined))
  );
}

/**
 * (Level 1) Keeps only the messages belonging to the CURRENT session — walking
 * back from the newest and cutting at the most recent gap longer than `idleMs`.
 * Input is chronological (oldest → newest). Prevents the intent classifier from
 * consolidating a subject the customer asked about in a previous, unrelated
 * session.
 */
export function boundMessagesToSession<T extends { createdAt: Date }>(
  messages: T[],
  idleMs: number = SESSION_IDLE_MS,
): T[] {
  if (messages.length <= 1) return messages;
  let cut = 0;
  for (let i = 1; i < messages.length; i += 1) {
    const gap = messages[i].createdAt.getTime() - messages[i - 1].createdAt.getTime();
    if (gap > idleMs) cut = i; // a session break sits before index i → keep from i
  }
  return messages.slice(cut);
}

/** (Level 1) The stored frame belongs to a previous session and must not carry. */
export function isFrameStale(
  inquiryUpdatedAt: Date | null | undefined,
  now: Date = new Date(),
  idleMs: number = SESSION_IDLE_MS,
): boolean {
  if (!inquiryUpdatedAt) return true;
  return now.getTime() - inquiryUpdatedAt.getTime() > idleMs;
}

/**
 * (Levels 2 + 3) Merges the latest turn's extracted fields into the stored frame.
 * - When the session is stale, the previous frame is ignored (fresh start).
 * - A new, different part type is a TOPIC SHIFT: the part slot is replaced and the
 *   `topicShift` flag is returned so the caller rebuilds the query from the new
 *   subject instead of the classifier's history-merged query. The vehicle slots
 *   (brand/model/year) are kept — within a session the customer is usually still
 *   asking about the same car, just a different part.
 * - Otherwise the latest non-null fields fill/override the frame (drip-fed detail).
 *
 * `latest` should already be evidence-gated (only fields the customer actually
 * said), so we never persist a hallucinated car.
 */
export function reconcileInquiryFrame(
  previous: InquiryFrame | null | undefined,
  latest: InquiryFrame,
  options: { sessionStale: boolean },
): { frame: InquiryFrame; topicShift: boolean } {
  const base = options.sessionStale ? null : previous;
  if (isFrameEmpty(base)) {
    return { frame: { ...latest }, topicShift: false };
  }
  const safeBase = base as InquiryFrame;

  const newPart = latest.partType;
  const topicShift = Boolean(
    newPart && safeBase.partType && normalizeSearchText(newPart) !== normalizeSearchText(safeBase.partType),
  );

  if (topicShift) {
    return {
      frame: {
        partType: latest.partType,
        carBrand: latest.carBrand ?? safeBase.carBrand,
        carModel: latest.carModel ?? safeBase.carModel,
        year: latest.year ?? safeBase.year,
      },
      topicShift: true,
    };
  }

  return {
    frame: {
      partType: latest.partType ?? safeBase.partType,
      carBrand: latest.carBrand ?? safeBase.carBrand,
      carModel: latest.carModel ?? safeBase.carModel,
      year: latest.year ?? safeBase.year,
    },
    topicShift: false,
  };
}

/** Clean search query rebuilt from the frame's subject (part + car). The model
 *  year is applied as a fitment filter, not a query token, so it never becomes a
 *  required token that zeroes out the search. Returns null when there's nothing. */
export function buildFrameQuery(frame: InquiryFrame): string | null {
  const tokens = [frame.partType, frame.carBrand, frame.carModel]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return tokens.length > 0 ? tokens.join(" ") : null;
}
