import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * Pure guardrails for staging an AI-suggested VEHICLE spelling. No DB import, so
 * they unit-test without a database. Mirrors
 * {@link ./category-alias-guardrails} but with the opposite collision rule: a
 * category alias must never shadow a vehicle name, whereas a vehicle spelling must
 * never shadow a PART word or an already-known vehicle spelling.
 */

export const MIN_STAGED_VEHICLE_SPELLING_LEN = 3;
export const MAX_STAGED_VEHICLE_SPELLING_LEN = 40;

/**
 * Thai + Latin letters, digits, spaces and the `-` that real model names use
 * ("D-Max", "BT-50", "MG 3", "CX-5"). Deliberately more permissive than the
 * category rule, which bans digits — a car model legitimately contains them.
 * Punctuation-only, emoji and free-form sentences are rejected.
 */
export const isStageableVehicleSpelling = (text: string | null | undefined): boolean => {
  const trimmed = text?.trim() ?? "";
  if (
    trimmed.length < MIN_STAGED_VEHICLE_SPELLING_LEN ||
    trimmed.length > MAX_STAGED_VEHICLE_SPELLING_LEN
  ) {
    return false;
  }
  if (!/^[฀-๿a-zA-Z0-9]+(?:[ -][฀-๿a-zA-Z0-9]+)*$/.test(trimmed)) return false;
  // Pure digits are a year or a part-number fragment, never a model spelling.
  if (/^\d+$/.test(trimmed.replace(/[ -]/g, ""))) return false;
  return true;
};

/**
 * True when the misspelling is ALREADY a known vehicle spelling — meaning it is a
 * real name in its own right, not a typo. Staging it as a synonym of some other
 * model would let one real vehicle resolve to a different one, which is the worst
 * failure this whole feature exists to prevent.
 *
 * `knownSpellings` should be every accepted spelling the resolver already honours
 * (master `CarModel`/`CarBrand` names plus every `SearchSynonym` cluster member).
 */
export const vehicleSpellingIsAlreadyKnown = (
  spelling: string,
  knownSpellings: string[],
): boolean => {
  const value = normalizeSearchText(spelling);
  if (!value) return true;
  return knownSpellings.some((known) => normalizeSearchText(known) === value);
};

/**
 * True when the misspelling collides with a PART word. A customer's part word must
 * never become a vehicle synonym — "คอยล์เย็น" resolving to a car model would
 * hard-filter every future search for that part to one vehicle.
 *
 * Containment in EITHER direction counts, because a part alias is often a fragment
 * of what the customer typed.
 */
export const vehicleSpellingCollidesWithPart = (
  spelling: string,
  partTerms: string[],
): boolean => {
  const value = normalizeSearchText(spelling);
  if (!value) return true;
  return partTerms.some((term) => {
    const part = normalizeSearchText(term);
    return Boolean(part) && (part === value || part.includes(value) || value.includes(part));
  });
};
