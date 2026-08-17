import { db } from "@/lib/db";
import { isStageableAliasText, aliasCollidesWithVehicle } from "@/lib/chat-core/category-alias-guardrails";

/**
 * Auto-staging of AI-corrected category aliases.
 *
 * When the deterministic resolver cannot map a customer's (often misspelled)
 * part word to a category, the LINE AI falls back to an LLM that corrects the
 * spelling; if the corrected word then maps to EXACTLY one active category, we
 * use it for the current search AND stage the misspelling as a PENDING
 * CategoryAlias for an admin to approve later.
 *
 * A staged alias is deliberately conservative:
 *  - `matchMode = EXACT` — a corrected typo maps 1:1, so it must never bleed into
 *    unrelated queries as a substring (the exact failure mode of the greedy
 *    "คอม" CONTAINS alias). EXACT keeps the blast radius to that literal word.
 *  - `isActive = false`, `reviewStatus = PENDING` — invisible to the live
 *    resolver (which filters `isActive`) until an admin approves it.
 *  - `source = AI_AUTO` — so the review queue can list only AI suggestions.
 *
 * Guardrails (pure, in category-alias-guardrails) reject junk and a DB-backed
 * collision check rejects anything that could shadow a car model/brand name.
 *
 * ── Why a sighting threshold (2026-08-17) ────────────────────────────────────
 * Staging on the FIRST sighting turned every one-off typo into a permanent row an
 * admin has to review, so the table grew faster than anyone could approve it. A
 * misspelling only earns a row once it is a PATTERN, which is measured from the
 * `CATEGORY_LLM_FALLBACK` audit rows both channels already write.
 *
 * The current turn's own audit row is written fire-and-forget, so it may or may
 * not be counted yet — meaning a repeated typo is staged on its 2nd or 3rd
 * sighting rather than exactly the 2nd. That fuzz is deliberate: making the count
 * exact would mean awaiting an observability write inside a reply path that has
 * to land within LINE's free reply-token window.
 */

/** Audit action both channels write when the LLM corrected a part spelling. */
export const CATEGORY_LLM_FALLBACK_AUDIT_ACTION = "CATEGORY_LLM_FALLBACK";

/** A typo must be seen at least this many times before it earns a review row. */
export const MIN_MISSPELLING_SIGHTINGS_BEFORE_STAGING = 2;

/**
 * PENDING AI suggestions nobody approved within this window are deleted rather
 * than left to pile up. Deleted (not REJECTED) on purpose: staging is idempotent
 * against ANY existing row, so a REJECTED tombstone would permanently block a
 * typo that later becomes common, while a deleted row lets it be re-proposed.
 */
export const STAGED_ALIAS_EXPIRY_DAYS = 30;

export type StageAiCategoryAliasResult =
  | { staged: true; id: string }
  | { staged: false; reason: string };

/**
 * Stage a PENDING AI-suggested alias. Best-effort and idempotent: any existing
 * row for the same (alias, kind) — already approved, pending, OR rejected — makes
 * this a no-op, so a previously rejected suggestion is never re-created.
 */
export async function stageAiCategoryAlias(input: {
  alias: string;
  categoryName: string;
  correctedTerm: string;
  originalText?: string | null;
}): Promise<StageAiCategoryAliasResult> {
  const alias = input.alias.trim();
  if (!isStageableAliasText(alias)) return { staged: false, reason: "GUARDRAIL_REJECTED" };

  const existing = await db.categoryAlias.findUnique({
    where: { alias_kind: { alias, kind: "MATCH" } },
    select: { id: true },
  });
  if (existing) return { staged: false, reason: "ALREADY_EXISTS" };

  // A pattern, not a one-off — see the sighting-threshold note above.
  const sightings = await db.lineAiAuditLog.count({
    where: {
      action: CATEGORY_LLM_FALLBACK_AUDIT_ACTION,
      payload: { path: ["original"], equals: alias },
    },
  });
  if (sightings < MIN_MISSPELLING_SIGHTINGS_BEFORE_STAGING) {
    return { staged: false, reason: "BELOW_SIGHTING_THRESHOLD" };
  }

  const [category, models, brands] = await Promise.all([
    db.category.findFirst({
      where: { isActive: true, name: input.categoryName },
      select: { id: true },
    }),
    db.carModel.findMany({ where: { isActive: true }, select: { name: true } }),
    db.carBrand.findMany({ where: { isActive: true }, select: { name: true } }),
  ]);
  if (!category) return { staged: false, reason: "CATEGORY_NOT_FOUND" };

  const vehicleNames = [...models.map((m) => m.name), ...brands.map((b) => b.name)];
  if (aliasCollidesWithVehicle(alias, vehicleNames)) return { staged: false, reason: "VEHICLE_COLLISION" };

  const created = await db.categoryAlias.create({
    data: {
      categoryId: category.id,
      alias,
      kind: "MATCH",
      matchMode: "EXACT",
      priority: 200,
      isActive: false,
      source: "AI_AUTO",
      reviewStatus: "PENDING",
      aiCorrectedTerm: input.correctedTerm.trim(),
      notes: `AI เสนอจากคำผิด "${input.originalText?.trim() || alias}" → "${input.correctedTerm.trim()}"`,
    },
    select: { id: true },
  });
  return { staged: true, id: created.id };
}

/**
 * Deletes AI suggestions nobody reviewed within {@link STAGED_ALIAS_EXPIRY_DAYS}.
 *
 * Scoped as tightly as possible — `source: AI_AUTO` + `reviewStatus: PENDING` +
 * `isActive: false` — so it can only ever remove rows this module created and that
 * the live resolver already ignores (it filters on `isActive`). Manual aliases,
 * approved aliases, and rejected tombstones are untouchable here.
 *
 * Best-effort: called fire-and-forget from the staging path so the review queue
 * stays bounded without adding a scheduled job. Never throws.
 */
export async function expireStaleAiCategoryAliases(
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - STAGED_ALIAS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  try {
    const { count } = await db.categoryAlias.deleteMany({
      where: {
        source: "AI_AUTO",
        reviewStatus: "PENDING",
        isActive: false,
        updatedAt: { lt: cutoff },
      },
    });
    return { deleted: count };
  } catch {
    return { deleted: 0 };
  }
}

/**
 * Messenger has no channel-specific AI audit table, so it records the correction
 * in LineAiAuditLog with a null LINE FK and the Messenger conversation id in the
 * payload — the same pattern as `logMessengerModelGroundingShadow`. Writing it is
 * what makes a repeated Messenger typo count toward the staging threshold.
 * Never throws.
 */
export async function logMessengerCategoryLlmFallback(input: {
  messengerConversationId: string;
  original: string;
  corrected: string;
  categoryName: string;
}): Promise<void> {
  try {
    await db.lineAiAuditLog.create({
      data: {
        conversationId: null,
        action: CATEGORY_LLM_FALLBACK_AUDIT_ACTION,
        payload: {
          channel: "messenger",
          messengerConversationId: input.messengerConversationId,
          original: input.original,
          corrected: input.corrected,
          categoryName: input.categoryName,
        },
      },
    });
  } catch {
    // Observability must never break or delay a customer reply.
  }
}
