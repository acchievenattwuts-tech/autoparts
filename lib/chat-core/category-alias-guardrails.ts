import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * Pure guardrails for auto-staging AI-corrected category aliases. Kept free of
 * any DB import so they can be unit-tested without a database/env.
 */

export const MIN_STAGED_ALIAS_LEN = 2;
export const MAX_STAGED_ALIAS_LEN = 40;

/** Thai + Latin letters and single spaces only — no digits, years, model codes,
 *  emoji or punctuation. */
export const isStageableAliasText = (text: string | null | undefined): boolean => {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length < MIN_STAGED_ALIAS_LEN || trimmed.length > MAX_STAGED_ALIAS_LEN) return false;
  // Allow the Thai block (฀-๿), Latin letters, and internal single spaces.
  if (!/^[฀-๿a-zA-Z]+(?: [฀-๿a-zA-Z]+)*$/.test(trimmed)) return false;
  return true;
};

/** True when the alias would shadow a vehicle name (equal, or one contains the
 *  other) — such an alias must never become a category filter. */
export const aliasCollidesWithVehicle = (
  alias: string,
  vehicleNames: string[],
): boolean => {
  const a = normalizeSearchText(alias);
  if (!a) return true;
  return vehicleNames.some((name) => {
    const n = normalizeSearchText(name);
    return Boolean(n) && (n === a || n.includes(a) || a.includes(n));
  });
};
