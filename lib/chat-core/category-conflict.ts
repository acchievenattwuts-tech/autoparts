import { matchDbCategoryAlias, matchPartTypeToCategoryHint } from "@/lib/chat-core/fitment-resolve";
import { isBroadChatPartType } from "@/lib/chat-core/search-gate";
import { containsWithinEditDistance } from "@/lib/chat-core/typo-distance";

/**
 * Detects the failure shape behind the 2026-08-17 incident: the resolver DID
 * produce a category, but it disagrees with the part word the customer actually
 * named ("พัดลม" answered with "คอยล์ร้อน (Condenser)", because the alias
 * "คอยร้อน" matched inside "แผงคอยร้อน" — see PLAN.md (4n)).
 *
 * The existing LLM spelling fallback only ran when NO category resolved, so the
 * "resolved but wrong" case never reached it. Worse, that fallback can only ADD a
 * category, never remove a wrong one. Both channels therefore ask this first and
 * DROP the disagreeing hard filter, which lets the existing fallback run and, if
 * it cannot supply a better category, leaves the turn unscoped (a wide search
 * beats a confidently wrong one — the free-text query and the part head-noun
 * anchor still constrain it).
 *
 * The decision is deterministic and made WITHOUT the model, so it keeps working
 * when Gemini is unavailable.
 */

const normalize = (value: string | null | undefined): string =>
  value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";

export type ChatCategoryPartTypeConflict = {
  disagrees: boolean;
  /** Category the part word maps to on its own, when it maps at all. */
  partTypeCategoryName: string | null;
};

/**
 * Thai part words are written glued and are routinely off by one character
 * ("โบลเวอร์" vs the catalog's "โบเวอร์"). One edit is enough to recognise that
 * as the same word — the same budget the intent guard uses.
 */
const PART_TYPE_SPELLING_MAX_EDITS = 1;

/**
 * True when the resolved category cannot be justified by the customer's part word.
 * Any ONE of these is enough to clear it:
 *
 *  - the category NAME contains the part word ("พัดลม" ⊂ "ใบพัดลม (Cooling Fan Blade)"),
 *    allowing one spelling edit so "โบลเวอร์" still matches "โบเวอร์ พัดลมแอร์…"
 *  - the part word maps to that same category on its own ("แผงแอร์" → Condenser)
 *  - the colloquial dictionary maps the part word to a fragment of that category
 *
 * A BROAD catch-all ("อะไหล่แอร์") can never justify any category, so it would
 * always "disagree" — which says nothing about whether the category is wrong.
 * Those turns are left alone; the search gate already handles them.
 *
 * Deliberately permissive: a false "agree" only preserves today's behaviour, while
 * a false "disagree" would drop a legitimate hard filter and widen the search.
 *
 * Pure + exported for unit testing.
 */
export const chatCategoryDisagreesWithPartType = (input: {
  partType: string | null | undefined;
  resolvedCategoryName: string | null | undefined;
  partTypeCategoryName?: string | null;
  partTypeCategoryHint?: string | null;
}): boolean => {
  const partType = normalize(input.partType);
  const category = normalize(input.resolvedCategoryName);
  if (!partType || !category) return false;
  if (isBroadChatPartType(partType)) return false;

  if (containsWithinEditDistance(partType, category, PART_TYPE_SPELLING_MAX_EDITS)) return false;
  if (normalize(input.partTypeCategoryName) === category) return false;

  const hint = normalize(input.partTypeCategoryHint);
  if (hint && category.includes(hint)) return false;

  return true;
};

/**
 * Resolves the part word against the SHARED cached alias rows (no extra DB
 * round-trip) and reports whether it disagrees with the resolved category.
 * Never throws — on any failure it reports "no disagreement", so a lookup problem
 * can only preserve current behaviour.
 */
export async function resolveChatCategoryPartTypeConflict(input: {
  partType: string | null | undefined;
  categoryName: string | null | undefined;
}): Promise<ChatCategoryPartTypeConflict> {
  const partType = input.partType?.trim() || null;
  const categoryName = input.categoryName?.trim() || null;
  if (!partType || !categoryName) return { disagrees: false, partTypeCategoryName: null };

  try {
    const aliasMatch = await matchDbCategoryAlias([partType]);
    const partTypeCategoryName = aliasMatch?.kind === "MATCH" ? aliasMatch.categoryName : null;
    return {
      partTypeCategoryName,
      disagrees: chatCategoryDisagreesWithPartType({
        partType,
        resolvedCategoryName: categoryName,
        partTypeCategoryName,
        partTypeCategoryHint: matchPartTypeToCategoryHint(partType),
      }),
    };
  } catch {
    return { disagrees: false, partTypeCategoryName: null };
  }
}
