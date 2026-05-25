import { normalizeSearchText } from "@/lib/search-normalization";

export const PRODUCT_SEARCH_REVIEW_STATUSES = [
  "pending",
  "applied",
  "ignored",
  "needs-investigation",
  "duplicate",
] as const;

export type ProductSearchReviewStatus = (typeof PRODUCT_SEARCH_REVIEW_STATUSES)[number];

const PRODUCT_SEARCH_REVIEW_STATUS_SET = new Set<string>(PRODUCT_SEARCH_REVIEW_STATUSES);

export const isProductSearchReviewStatus = (value: string): value is ProductSearchReviewStatus =>
  PRODUCT_SEARCH_REVIEW_STATUS_SET.has(value);

export const buildProductSearchReviewOutcomeKey = ({
  normalizedQuery,
  candidateAction,
}: {
  normalizedQuery: string;
  candidateAction: string;
}) => ({
  normalizedQuery: normalizeSearchText(normalizedQuery),
  candidateAction: candidateAction.trim(),
});
