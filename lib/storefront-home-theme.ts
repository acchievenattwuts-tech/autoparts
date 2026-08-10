/**
 * Shared class tokens for the /home2 white + blue theme.
 *
 * Written as complete literal class strings (never interpolated from colour
 * variables) so Tailwind's source scanner still sees every utility it has to
 * generate. Blue is the primary colour everywhere; orange (#f97316) is kept
 * strictly for prices, matching the rest of the storefront.
 */

/** Deep navy used for the header bar and primary surfaces. */
export const STOREFRONT_HEADER_BAR_CLASS =
  "bg-gradient-to-b from-[#1e3a5f] to-[#254b7a]";

/** Section wrapper — white card on the pale blue page background. */
export const STOREFRONT_SECTION_CARD_CLASS =
  "rounded-2xl border border-[#dbe6f5] bg-white shadow-[0_1px_3px_rgba(30,58,95,0.08)]";

/** Price colour — the one place orange survives on this page. */
export const STOREFRONT_PRICE_TEXT_CLASS = "text-[#f97316]";
