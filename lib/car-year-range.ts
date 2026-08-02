/**
 * Car-year range filter semantics, shared by the storefront and admin product
 * filters so the two can never drift apart.
 *
 * The filter matches a fitment row whose [yearStart, yearEnd] OVERLAPS the range
 * asked for. That is right for a real range, but a half-filled range reads very
 * differently to the person typing it: "ช่วงปีรถ 2010 – (ว่าง)" looks like "a 2010
 * car" while the engine reads it as "2010 onwards" — so a part listed only for
 * Jazz 2014+ came back for a 2010 Jazz (reported 2026-08-02).
 *
 * Rule: ONE side filled means that exact model year; a real range needs both
 * sides. Applied at parse time so the filter chips show the same range the query
 * runs, and so a hand-typed or bookmarked URL behaves like the form.
 */

/** Mirrors a half-filled range onto both ends. Full and empty ranges pass through. */
export function resolveCarYearRangeFilter(
  yearMin: number | null | undefined,
  yearMax: number | null | undefined,
): { yearMin: number | null; yearMax: number | null } {
  const min = yearMin ?? null;
  const max = yearMax ?? null;
  if (min !== null && max === null) return { yearMin: min, yearMax: min };
  if (min === null && max !== null) return { yearMin: max, yearMax: max };
  return { yearMin: min, yearMax: max };
}

/** String-param form, for filters that keep their values as raw query strings. */
export function resolveCarYearRangeFilterStrings(
  yearMin: string | undefined,
  yearMax: string | undefined,
): { yearMin: string | undefined; yearMax: string | undefined } {
  const min = yearMin?.trim() || undefined;
  const max = yearMax?.trim() || undefined;
  if (min && !max) return { yearMin: min, yearMax: min };
  if (!min && max) return { yearMin: max, yearMax: max };
  return { yearMin: min, yearMax: max };
}
