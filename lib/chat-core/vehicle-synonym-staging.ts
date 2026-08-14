import { db } from "@/lib/db";
import { normalizeSearchText } from "@/lib/search-normalization";
import {
  isStageableVehicleSpelling,
  vehicleSpellingCollidesWithPart,
  vehicleSpellingIsAlreadyKnown,
} from "@/lib/chat-core/vehicle-synonym-guardrails";

/**
 * Staging of AI-suggested VEHICLE spellings into the review queue that already
 * exists — no new table, no new admin page.
 *
 * The flow, end to end:
 *   1. The chat pipeline fails to resolve a car model the customer named.
 *   2. `logChatProductSearchTelemetry` records the turn in `ProductSearchLog`, so
 *      the query shows up as a cluster in the no-result quality report.
 *   3. `correctVehicleSpelling` proposes the canonical model the customer meant.
 *   4. THIS module re-resolves that proposal against the real `CarModel` /
 *      `CarBrand` tables and stages it as a PENDING `ProductSearchReviewOutcome`,
 *      attached to the same cluster.
 *   5. The admin opens the existing review sheet, sees the AI's suggestion, and
 *      applies it — which writes a `SearchSynonym` row through the existing
 *      `applySearchSynonymCandidate` action.
 *   6. `SearchSynonym` is already wired into all three resolution points
 *      (`resolveCanonicalCarModelHint`, the guard's model-synonym evidence, and
 *      `resolveKnownQueryIntent`'s synonym promotion), so one approval fixes the
 *      spelling everywhere at once.
 *
 * The ">95% confidence" bar is enforced by step 4 — the proposal is used only when
 * it names exactly ONE active vehicle in master data — and by the human in step 5.
 * A self-reported LLM score is never trusted.
 */

/** The review queue keys on this; it is a plain VarChar column plus a TS union, so
 *  adding a value needs no migration. Kept distinct from `search-synonym` (which is
 *  derived from storefront log text) so the two sources stay separable in reports. */
export const VEHICLE_SYNONYM_CANDIDATE_ACTION = "vehicle-synonym";

/** Marks a note as machine-written, so a later run can tell its own row from an
 *  admin's and refuse to overwrite human wording. */
export const VEHICLE_SYNONYM_NOTE_PREFIX = "[AI]";

export type StageVehicleSynonymResult =
  | { staged: true; canonicalTerm: string; misspelling: string }
  | { staged: false; reason: string };


/**
 * Resolves a proposed spelling to the canonical name of exactly ONE active vehicle.
 * Returns null when it matches nothing, or when it is ambiguous across rows — an
 * ambiguous vehicle must never become a hard filter.
 *
 * Models are checked before brands: the classifier's failure is almost always a
 * model, and a model is the more specific signal.
 */
export async function resolveVehicleSpellingTarget(
  corrected: string | null | undefined,
): Promise<{ canonicalTerm: string; kind: "carModel" | "carBrand" } | null> {
  const value = corrected?.trim();
  if (!value) return null;

  const models = await db.carModel.findMany({
    where: {
      isActive: true,
      carBrand: { isActive: true },
      name: { equals: value, mode: "insensitive" },
    },
    select: { name: true },
    take: 2,
  });
  if (models.length === 1) return { canonicalTerm: models[0].name, kind: "carModel" };
  // Two rows means the name is shared across brands — ambiguous, so drop it rather
  // than pick one. (Production has such duplicates, e.g. differing only by case.)
  if (models.length > 1) return null;

  const brands = await db.carBrand.findMany({
    where: { isActive: true, name: { equals: value, mode: "insensitive" } },
    select: { name: true },
    take: 2,
  });
  if (brands.length === 1) return { canonicalTerm: brands[0].name, kind: "carBrand" };

  return null;
}

/**
 * Stages a PENDING review row for `misspelling → canonicalTerm`.
 *
 * Best-effort and idempotent. It never overwrites a row an admin has already acted
 * on (anything not PENDING), and never overwrites an admin's own note.
 */
export async function stageVehicleSynonymSuggestion(input: {
  /** What the customer actually typed. */
  misspelling: string;
  /** What the LLM proposed, BEFORE master-data resolution. */
  corrected: string;
}): Promise<StageVehicleSynonymResult> {
  const misspelling = input.misspelling.trim();
  if (!isStageableVehicleSpelling(misspelling)) {
    return { staged: false, reason: "GUARDRAIL_REJECTED" };
  }

  const target = await resolveVehicleSpellingTarget(input.corrected);
  if (!target) return { staged: false, reason: "NO_UNIQUE_VEHICLE" };

  const normalizedQuery = normalizeSearchText(misspelling);
  if (!normalizedQuery) return { staged: false, reason: "EMPTY_AFTER_NORMALIZE" };
  if (normalizedQuery === normalizeSearchText(target.canonicalTerm)) {
    return { staged: false, reason: "ALREADY_CANONICAL" };
  }

  const [models, brands, synonyms, categories, categoryAliases] = await Promise.all([
    db.carModel.findMany({ where: { isActive: true }, select: { name: true } }),
    db.carBrand.findMany({ where: { isActive: true }, select: { name: true } }),
    db.searchSynonym.findMany({ where: { isActive: true }, select: { term: true, synonyms: true } }),
    db.category.findMany({ where: { isActive: true }, select: { name: true } }),
    db.categoryAlias.findMany({ where: { isActive: true }, select: { alias: true } }),
  ]);

  // Already a real vehicle name / accepted spelling → it is not a typo at all.
  const knownSpellings = [
    ...models.map((row) => row.name),
    ...brands.map((row) => row.name),
    ...synonyms.flatMap((row) => [row.term, ...(row.synonyms ?? [])]),
  ];
  if (vehicleSpellingIsAlreadyKnown(misspelling, knownSpellings)) {
    return { staged: false, reason: "ALREADY_KNOWN_SPELLING" };
  }

  // A part word must never become a vehicle synonym.
  const partTerms = [
    ...categories.map((row) => row.name),
    ...categoryAliases.map((row) => row.alias),
  ];
  if (vehicleSpellingCollidesWithPart(misspelling, partTerms)) {
    return { staged: false, reason: "PART_WORD_COLLISION" };
  }

  const note = `${VEHICLE_SYNONYM_NOTE_PREFIX} เดาว่าลูกค้าหมายถึง "${target.canonicalTerm}" (พิมพ์มาว่า "${misspelling}") — ตรวจแล้วอนุมัติเพื่อเพิ่มเป็นคำพ้อง`;

  try {
    const existing = await db.productSearchReviewOutcome.findUnique({
      where: {
        normalizedQuery_candidateAction: {
          normalizedQuery,
          candidateAction: VEHICLE_SYNONYM_CANDIDATE_ACTION,
        },
      },
      select: { status: true, note: true },
    });

    // An admin already decided (applied / ignored / duplicate / investigating) —
    // never resurrect it, and never re-suggest something they rejected.
    if (existing && existing.status !== "PENDING") {
      return { staged: false, reason: `ALREADY_REVIEWED_${existing.status}` };
    }
    // A pending row whose note an admin edited by hand keeps their wording.
    if (existing?.note && !existing.note.startsWith(VEHICLE_SYNONYM_NOTE_PREFIX)) {
      return { staged: false, reason: "ADMIN_NOTE_PRESENT" };
    }

    await db.productSearchReviewOutcome.upsert({
      where: {
        normalizedQuery_candidateAction: {
          normalizedQuery,
          candidateAction: VEHICLE_SYNONYM_CANDIDATE_ACTION,
        },
      },
      create: {
        normalizedQuery,
        candidateAction: VEHICLE_SYNONYM_CANDIDATE_ACTION,
        status: "PENDING",
        note,
        // Carries the proposed target so the review sheet can pre-fill the synonym
        // term. It stays a PROPOSAL while status is PENDING, and becomes literally
        // "what was applied" the moment an admin approves (the apply action
        // overwrites appliedType/appliedRef itself).
        appliedRef: target.canonicalTerm.slice(0, 100),
      },
      update: { status: "PENDING", note, appliedRef: target.canonicalTerm.slice(0, 100) },
    });

    return { staged: true, canonicalTerm: target.canonicalTerm, misspelling };
  } catch {
    return { staged: false, reason: "WRITE_FAILED" };
  }
}
