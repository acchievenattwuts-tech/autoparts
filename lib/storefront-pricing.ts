const COMPARE_AT_MULTIPLIER = 1.3;

export function getStorefrontDisplayPrices(price: number | { toString(): string }) {
  const salePrice = Number(price);
  const compareAtPrice = Math.ceil(salePrice * COMPARE_AT_MULTIPLIER);

  return {
    salePrice,
    compareAtPrice,
  };
}
