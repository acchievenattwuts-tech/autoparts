import type { ResolvedNormalPrice } from "./resolve-price";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ScheduledPromotionCandidate = {
  id: string;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  startDateKey: string;
  endDateKey: string;
  promotionPrice: number;
};

export type ScheduledPriceResult = {
  amount: number;
  source: "NORMAL_PRICE" | "PROMOTION";
  promotionId: string | null;
  normalPrice: number;
};

const assertDateKey = (value: string, label: string): void => {
  if (!DATE_KEY_PATTERN.test(value)) throw new Error(`${label} must be YYYY-MM-DD`);
};

export const promotionRangesOverlapInclusive = (
  left: Pick<ScheduledPromotionCandidate, "startDateKey" | "endDateKey">,
  right: Pick<ScheduledPromotionCandidate, "startDateKey" | "endDateKey">,
): boolean =>
  left.startDateKey <= right.endDateKey && right.startDateKey <= left.endDateKey;

/** Resolve a scheduled override against the sale document's Thailand date key. */
export function resolveScheduledPrice(input: {
  saleDateKey: string;
  normalPrice: ResolvedNormalPrice;
  promotions: readonly ScheduledPromotionCandidate[];
}): ScheduledPriceResult {
  assertDateKey(input.saleDateKey, "saleDateKey");
  const active = input.promotions.filter((promotion) => {
    assertDateKey(promotion.startDateKey, "promotion.startDateKey");
    assertDateKey(promotion.endDateKey, "promotion.endDateKey");
    return (
      promotion.status === "PUBLISHED" &&
      promotion.startDateKey <= input.saleDateKey &&
      input.saleDateKey <= promotion.endDateKey
    );
  });
  if (active.length > 1) throw new Error("OVERLAPPING_PUBLISHED_PRICE_PROMOTIONS");
  if (active.length === 0) {
    return {
      amount: input.normalPrice.amount,
      source: "NORMAL_PRICE",
      promotionId: null,
      normalPrice: input.normalPrice.amount,
    };
  }
  if (input.normalPrice.isMissing) throw new Error("PROMOTION_NORMAL_PRICE_MISSING");
  return {
    amount: active[0].promotionPrice,
    source: "PROMOTION",
    promotionId: active[0].id,
    normalPrice: input.normalPrice.amount,
  };
}

/**
 * More than one PUBLISHED promotion covers the same product on the sale date.
 * Publishing normally blocks this, so the user fixes it on the price-promotion
 * page; the message is written for users and is returned as-is.
 */
export class PricePromotionOverlapError extends Error {
  constructor(productLabels: readonly string[]) {
    super(
      `มีโปรโมชั่นราคาที่เผยแพร่ซ้อนกันสำหรับสินค้า ${productLabels.join(", ")} กรุณาตรวจสอบหน้าโปรโมชั่นราคา`,
    );
    this.name = "PricePromotionOverlapError";
  }
}

export type PublishedPromotionRow = {
  productId: string;
  product: { code: string; name: string };
};

/**
 * Index the PUBLISHED promotion rows active on the sale date by product.
 * Throws PricePromotionOverlapError naming every product with more than one row.
 */
export function indexPublishedPromotionsByProduct<T extends PublishedPromotionRow>(
  rows: readonly T[],
): Map<string, T> {
  const byProduct = new Map<string, T>();
  const overlappingLabels = new Map<string, string>();
  for (const row of rows) {
    if (byProduct.has(row.productId)) {
      overlappingLabels.set(row.productId, `${row.product.code} ${row.product.name}`);
      continue;
    }
    byProduct.set(row.productId, row);
  }
  if (overlappingLabels.size > 0) throw new PricePromotionOverlapError([...overlappingLabels.values()]);
  return byProduct;
}

export const isPromotionBelowCost = (promotionPrice: number, costPrice: number): boolean =>
  promotionPrice < costPrice;

export const shouldWarnPromotionDiscountStacking = (input: {
  promotionApplied: boolean;
  lineDiscount: number;
  billDiscount: number;
}): boolean => input.promotionApplied && (input.lineDiscount > 0 || input.billDiscount > 0);
