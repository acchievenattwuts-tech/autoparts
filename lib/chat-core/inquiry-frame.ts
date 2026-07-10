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

/** Idle gap that ends a conversation session (120 min). Parts shoppers often go
 *  quiet for a while — checking the car, asking a mechanic — then resume the same
 *  inquiry, so the window is wide to favour continuity over premature reset. */
export const SESSION_IDLE_MS = 120 * 60_000;

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
  options: {
    sessionStale: boolean;
    /**
     * The part word the classifier read from THIS turn's text BEFORE evidence
     * grounding. A misspelled part ("วาว์ล" for วาล์วแอร์) fails the literal
     * evidence check, so `latest.partType` arrives null and the carried part
     * would otherwise stick — even though the customer clearly named a new part
     * AND switched cars. Used only to detect that a new part was named when the
     * vehicle also changed; never persisted directly.
     */
    latestClassifierPartType?: string | null;
  },
): { frame: InquiryFrame; topicShift: boolean; droppedStalePart: boolean } {
  const base = options.sessionStale ? null : previous;
  if (isFrameEmpty(base)) {
    return { frame: { ...latest }, topicShift: false, droppedStalePart: false };
  }
  const safeBase = base as InquiryFrame;

  const newPart = latest.partType;
  const topicShift = Boolean(
    newPart && safeBase.partType && normalizeSearchText(newPart) !== normalizeSearchText(safeBase.partType),
  );

  // Vehicle-slot merge. A NEW car model that differs from the carried one means the
  // customer switched vehicles — the stored brand/year belong to the OLD car and
  // must not stick (otherwise e.g. carried brand "Toyota" + new model "D-Max"
  // yields the impossible "Toyota D-Max", which later hard-filters to Toyota). When
  // the model changes, only carry brand/year if THIS turn supplied them.
  const modelChanged = Boolean(
    latest.carModel &&
      safeBase.carModel &&
      normalizeSearchText(latest.carModel) !== normalizeSearchText(safeBase.carModel),
  );
  const vehicle = {
    carBrand: latest.carBrand ?? (modelChanged ? null : safeBase.carBrand),
    carModel: latest.carModel ?? safeBase.carModel,
    year: latest.year ?? (modelChanged ? null : safeBase.year),
  };

  if (topicShift) {
    return {
      frame: { partType: latest.partType, ...vehicle },
      topicShift: true,
      droppedStalePart: false,
    };
  }

  // Stale-part guard: the customer switched to a DIFFERENT vehicle model this turn
  // AND named a new part word that failed grounding (typically a misspelling, so
  // `latest.partType` is null). Inheriting the previous car's part here wrongly
  // hard-filters the new-car query to the old category — e.g. after "หม้อน้ำ
  // commuter", the message "วาว์ลอัลติสแท้03" (วาล์วแอร์ Altis) must NOT stay
  // หม้อน้ำ. Drop the carried part so the search rebuilds from the classifier's
  // consolidated query (which carries the customer's real words). Gated on the
  // classifier having read a DIFFERENT part this turn, so a pure vehicle-only
  // follow-up ("แล้ว Vigo ล่ะ") keeps its carried part.
  const classifierPart = options.latestClassifierPartType;
  const namedNewPart = Boolean(
    classifierPart &&
      (!safeBase.partType || normalizeSearchText(classifierPart) !== normalizeSearchText(safeBase.partType)),
  );
  const droppedStalePart = !latest.partType && modelChanged && namedNewPart;

  return {
    frame: {
      partType: latest.partType ?? (droppedStalePart ? null : safeBase.partType),
      ...vehicle,
    },
    topicShift: false,
    droppedStalePart,
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
