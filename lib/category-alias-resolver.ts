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

  const match = activeRows.find(
    (row) =>
      row.kind === "MATCH" &&
      row.category?.isActive &&
      normalizedTexts.some((text) => aliasMatchesText(text, row.alias, row.matchMode)),
  );
  if (!match?.category) return null;

  return {
    kind: "MATCH",
    alias: match.alias,
    categoryId: match.category.id,
    categoryName: match.category.name,
  };
}
