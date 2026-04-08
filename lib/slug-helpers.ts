import { slugifySegment } from "./product-slug";

type BuildUniqueSlugInput = {
  value: string;
  taken: Iterable<string>;
  fallback?: string;
  extraCandidates?: string[];
  slugify?: (value: string) => string;
};

const normalizeCandidate = (
  value: string,
  fallback: string,
  slugify: (value: string) => string,
) => {
  const slug = slugify(value);
  return slug || fallback;
};

export const buildUniqueSlug = ({
  value,
  taken,
  fallback = "item",
  extraCandidates = [],
  slugify = slugifySegment,
}: BuildUniqueSlugInput): string => {
  const takenSet = taken instanceof Set ? taken : new Set(taken);
  const base = normalizeCandidate(value, fallback, slugify);
  const candidates = [
    base,
    ...extraCandidates
      .map((candidate) => normalizeCandidate(candidate, fallback, slugify))
      .filter((candidate) => candidate !== base),
  ];

  for (const candidate of candidates) {
    if (!takenSet.has(candidate)) {
      takenSet.add(candidate);
      return candidate;
    }
  }

  let suffix = 2;
  while (true) {
    const candidate = `${base}-${suffix}`;
    if (!takenSet.has(candidate)) {
      takenSet.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
};
