/**
 * Shared class tokens for the /home2 white + blue theme.
 *
 * Written as complete literal class strings (never interpolated from colour
 * variables) so Tailwind's source scanner still sees every utility it has to
 * generate. Blue is the primary colour everywhere; orange (#f97316) is kept
 * strictly for prices, matching the rest of the storefront.
 */

/** Deep navy used for the header bar and primary surfaces. */
export const HOME2_HEADER_BAR_CLASS =
  "bg-gradient-to-b from-[#1e3a5f] to-[#254b7a]";

/** Primary blue action button (pill). */
export const HOME2_PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#163055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2";

/** Secondary/outline blue button on a white surface. */
export const HOME2_OUTLINE_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[#1e3a5f]/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:border-[#1e3a5f]/40 hover:bg-[#eff5fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2";

/** Section wrapper — white card on the pale blue page background. */
export const HOME2_SECTION_CARD_CLASS =
  "rounded-2xl border border-[#dbe6f5] bg-white shadow-[0_1px_3px_rgba(30,58,95,0.08)]";

/** Small blue pill used for badges and category counts. */
export const HOME2_BADGE_CLASS =
  "inline-flex items-center gap-1 rounded-full bg-[#eff5fc] px-2.5 py-0.5 text-xs font-semibold text-[#1e3a5f]";

/** Price colour — the one place orange survives on this page. */
export const HOME2_PRICE_TEXT_CLASS = "text-[#f97316]";

/** Horizontal rail: scroll-snap on touch, hidden scrollbar like Shopee. */
export const HOME2_RAIL_CLASS =
  "flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
