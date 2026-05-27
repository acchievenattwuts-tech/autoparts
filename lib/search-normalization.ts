const SEARCH_JOINER_PATTERN = /[-_/\\.,]+/g;
const SEARCH_COMPACT_PATTERN = /[\s\-_/\\.,]+/g;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

export const normalizeSearchText = (value?: string | null): string => {
  if (!value) return "";

  return normalizeWhitespace(
    value
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .toLowerCase(),
  );
};

export const buildSearchVariants = (value?: string | null): string[] => {
  const base = normalizeSearchText(value);
  if (!base) return [];

  const spacedJoiners = normalizeWhitespace(base.replace(SEARCH_JOINER_PATTERN, " "));
  const compact = base.replace(SEARCH_COMPACT_PATTERN, "");
  const splitAlphaNumeric = normalizeWhitespace(
    compact
      .replace(/([\p{L}])(\d)/gu, "$1 $2")
      .replace(/(\d)([\p{L}])/gu, "$1 $2"),
  );

  return Array.from(
    new Set([base, spacedJoiners, compact, splitAlphaNumeric].filter(Boolean)),
  );
};

export const tokenizeSearchVariants = (value?: string | null): string[] => {
  const tokens = new Set<string>();

  for (const variant of buildSearchVariants(value)) {
    tokens.add(variant);
    for (const token of variant.split(/\s+/).filter(Boolean)) {
      tokens.add(token);
    }
  }

  return Array.from(tokens);
};
