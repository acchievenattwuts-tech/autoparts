import { slugifySegment } from "./product-slug";

type BuildUniqueSlugInput = {
  value: string;
  taken: Iterable<string>;
  fallback?: string;
  extraCandidates?: string[];
};

const normalizeCandidate = (value: string, fallback: string) => {
  const slug = slugifySegment(value);
  return slug || fallback;
};

export const buildUniqueSlug = ({
  value,
  taken,
  fallback = "item",
  extraCandidates = [],
}: BuildUniqueSlugInput): string => {
  const takenSet = taken instanceof Set ? taken : new Set(taken);
  const base = normalizeCandidate(value, fallback);
  const candidates = [
    base,
    ...extraCandidates
      .map((candidate) => normalizeCandidate(candidate, fallback))
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
