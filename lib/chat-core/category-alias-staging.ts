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
 */

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
