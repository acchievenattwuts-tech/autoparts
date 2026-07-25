export type CategoryAliasKindValue = "MATCH" | "SKIP_CATEGORY";
export type CategoryAliasMatchModeValue = "EXACT" | "CONTAINS" | "TOKEN";

export type CategoryAliasResolverRow = {
  alias: string;
  kind: CategoryAliasKindValue;
  matchMode: CategoryAliasMatchModeValue;
  priority: number;
  isActive: boolean;
  category: {
    id: string;
    name: string;
    isActive: boolean;
  } | null;
};

export type CategoryAliasMatchResult =
  | {
      kind: "MATCH";
      alias: string;
      categoryId: string;
      categoryName: string;
    }
  | {
      kind: "SKIP_CATEGORY";
      alias: string;
    };

export type CategoryAliasEvidence = {
  alias: string;
  categoryId: string;
  categoryName: string;
  matchMode: CategoryAliasMatchModeValue;
  priority: number;
  start: number;
  end: number;
};

export type CategoryAliasEvidenceResult = {
  matches: CategoryAliasEvidence[];
  skippedBy: string | null;
};

const normalizeAliasText = (value: string | null | undefined): string =>
  value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";

const tokenizeAliasText = (value: string): string[] =>
  normalizeAliasText(value)
    .split(/[\s,./()[\]{}:;'"|\\!?+-]+/)
    .filter(Boolean);

function aliasMatchesText(text: string, alias: string, matchMode: CategoryAliasMatchModeValue): boolean {
  const normalizedText = normalizeAliasText(text);
  const normalizedAlias = normalizeAliasText(alias);
  if (!normalizedText || !normalizedAlias) return false;

  if (matchMode === "EXACT") return normalizedText === normalizedAlias;
  if (matchMode === "TOKEN") return tokenizeAliasText(normalizedText).includes(normalizedAlias);
  return normalizedText.includes(normalizedAlias);
}

function sortAliasRows(rows: CategoryAliasResolverRow[]): CategoryAliasResolverRow[] {
  return [...rows].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return normalizeAliasText(b.alias).length - normalizeAliasText(a.alias).length;
  });
}

const TOKEN_SEPARATOR_RE = /[\s,./()[\]{}:;'"|\\!?+&=-]+/g;

function aliasMatchRanges(
  text: string,
  alias: string,
  matchMode: CategoryAliasMatchModeValue,
): Array<{ start: number; end: number }> {
  if (!text || !alias) return [];
  if (matchMode === "EXACT") {
    return text === alias ? [{ start: 0, end: text.length }] : [];
  }
  if (matchMode === "TOKEN") {
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const separator of text.matchAll(TOKEN_SEPARATOR_RE)) {
      const separatorStart = separator.index ?? cursor;
      if (separatorStart > cursor && text.slice(cursor, separatorStart) === alias) {
        ranges.push({ start: cursor, end: separatorStart });
      }
      cursor = separatorStart + separator[0].length;
    }
    if (cursor < text.length && text.slice(cursor) === alias) {
      ranges.push({ start: cursor, end: text.length });
    }
    return ranges;
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= text.length - alias.length) {
    const start = text.indexOf(alias, from);
    if (start < 0) break;
    ranges.push({ start, end: start + alias.length });
    from = start + Math.max(alias.length, 1);
  }
  return ranges;
}

/**
 * Returns every distinct canonical category explicitly evidenced in one text.
 * Unlike `matchCategoryAliasRows`, this is intended only for multi-subject
 * detection. It applies a conservative longest-span guard so compound aliases
 * ("หน้าคลัชคอมแอร์") suppress nested generic aliases ("คอมแอร์").
 */
export function matchAllCategoryAliasRows(
  text: string | null | undefined,
  rows: CategoryAliasResolverRow[],
): CategoryAliasEvidenceResult {
  const normalizedText = normalizeAliasText(text?.normalize("NFKC"));
  if (!normalizedText) return { matches: [], skippedBy: null };

  const activeRows = rows.filter((row) => row.isActive && normalizeAliasText(row.alias));
  for (const row of sortAliasRows(activeRows.filter((candidate) => candidate.kind === "SKIP_CATEGORY"))) {
    const alias = normalizeAliasText(row.alias.normalize("NFKC"));
    if (aliasMatchRanges(normalizedText, alias, row.matchMode).length > 0) {
      return { matches: [], skippedBy: row.alias };
    }
  }

  const candidates: CategoryAliasEvidence[] = [];
  for (const row of activeRows) {
    if (row.kind !== "MATCH" || !row.category?.isActive) continue;
    const alias = normalizeAliasText(row.alias.normalize("NFKC"));
    for (const range of aliasMatchRanges(normalizedText, alias, row.matchMode)) {
      candidates.push({
        alias: row.alias,
        categoryId: row.category.id,
        categoryName: row.category.name,
        matchMode: row.matchMode,
        priority: row.priority,
        ...range,
      });
    }
  }

  // Specific/long evidence wins before priority. This is intentionally stricter
  // than the single-category resolver: false multi is more harmful than falling
  // back to the existing single/handoff path.
  candidates.sort((a, b) => {
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.start - b.start;
  });

  const accepted: CategoryAliasEvidence[] = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some(
      (existing) => candidate.start < existing.end && candidate.end > existing.start,
    );
    if (!overlaps) accepted.push(candidate);
  }

  accepted.sort((a, b) => a.start - b.start || b.priority - a.priority);
  const seenCategories = new Set<string>();
  return {
    matches: accepted.filter((match) => {
      if (seenCategories.has(match.categoryId)) return false;
      seenCategories.add(match.categoryId);
      return true;
    }),
    skippedBy: null,
  };
}

/**
 * Best MATCH row for one normalized text. A compound alias suppresses aliases
 * NESTED inside its span — "พัดลมคอนเดนเซอร์" (Condenser Fan Motor, 225) must
 * not lose to the embedded "คอนเดนเซอร์" (Condenser, 240) just because the
 * short inner alias carries a higher priority: the longer word is what the
 * customer actually typed. Non-overlapping matches keep the original
 * priority-then-length ordering, so multi-part texts ("กรองแอร์กับกรองอากาศ")
 * behave exactly as before. Same longest-span-first principle as
 * `matchAllCategoryAliasRows`.
 */
function bestAliasMatchInText(
  text: string,
  activeRows: CategoryAliasResolverRow[],
): CategoryAliasResolverRow | null {
  type Candidate = { row: CategoryAliasResolverRow; start: number; end: number };
  const candidates: Candidate[] = [];
  for (const row of activeRows) {
    if (row.kind !== "MATCH" || !row.category?.isActive) continue;
    const alias = normalizeAliasText(row.alias);
    for (const range of aliasMatchRanges(text, alias, row.matchMode)) {
      candidates.push({ row, ...range });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      b.row.priority - a.row.priority ||
      a.start - b.start,
  );
  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some(
      (existing) => candidate.start < existing.end && candidate.end > existing.start,
    );
    if (!overlaps) accepted.push(candidate);
  }

  accepted.sort(
    (a, b) => b.row.priority - a.row.priority || b.end - b.start - (a.end - a.start),
  );
  return accepted[0].row;
}

export function matchCategoryAliasRows(
  texts: Array<string | null | undefined>,
  rows: CategoryAliasResolverRow[],
): CategoryAliasMatchResult | null {
  const normalizedTexts = texts.map(normalizeAliasText).filter(Boolean);
  if (normalizedTexts.length === 0) return null;

  const activeRows = sortAliasRows(rows).filter((row) => row.isActive && normalizeAliasText(row.alias));

  const skip = activeRows.find(
    (row) =>
      row.kind === "SKIP_CATEGORY" &&
      normalizedTexts.some((text) => aliasMatchesText(text, row.alias, row.matchMode)),
  );
  if (skip) {
    return { kind: "SKIP_CATEGORY", alias: skip.alias };
  }

  // Best alias PER TEXT first, then pick across texts by priority / alias
  // length — but break ties by TEXT ORDER, because callers pass the most
  // trustworthy source first (partType, then the consolidated query, then raw
  // text). Two equal-priority aliases living in DIFFERENT texts must not race
  // on DB row order — e.g. partType "แผงแอร์" (Condenser, 240) vs an
  // AI-rewritten query "ตู้แอร์" (Evaporator, 240): the partType's category
  // wins. A strictly HIGHER-priority alias in a later text (the customer's own
  // precise keyword in the raw text) still wins.
  let best: CategoryAliasResolverRow | null = null;
  for (const text of normalizedTexts) {
    const match = bestAliasMatchInText(text, activeRows);
    if (!match?.category) continue;
    const beatsBest =
      !best ||
      match.priority > best.priority ||
      (match.priority === best.priority &&
        normalizeAliasText(match.alias).length > normalizeAliasText(best.alias).length);
    if (beatsBest) best = match;
  }
  if (!best?.category) return null;

  return {
    kind: "MATCH",
    alias: best.alias,
    categoryId: best.category.id,
    categoryName: best.category.name,
  };
}
