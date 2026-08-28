import type { LegacyPriceTier, SystemPriceListCode } from "./price-lists";

export type LegacyProductPrices = {
  salePrice: number | null | undefined;
  memberPrice: number | null | undefined;
  retailPrice: number | null | undefined;
};

export type ResolvedNormalPrice = {
  amount: number;
  source: "PRICE_LIST" | "LEGACY_COMPATIBILITY" | "MISSING";
  isMissing: boolean;
  usedRetailFallback: boolean;
};

/** Exact legacy behavior used by the STORE sale form before Price List rollout. */
export function resolveLegacySalePrice(
  product: LegacyProductPrices,
  tier: LegacyPriceTier,
): number {
  const wholesale = product.salePrice ?? 0;
  if (tier === "WHOLESALE") return wholesale;
  if (tier === "MEMBER") return product.memberPrice ?? 0;
  const retail = product.retailPrice ?? 0;
  return retail > 0 ? retail : wholesale;
}

/** Exact legacy chat behavior: RETAIL never inherits the sale-form fallback. */
export function resolveLegacyChatPrice(
  product: LegacyProductPrices,
  tier: LegacyPriceTier,
): number {
  if (tier === "WHOLESALE") return product.salePrice ?? 0;
  if (tier === "MEMBER") return product.memberPrice ?? 0;
  return product.retailPrice ?? 0;
}

export function resolveChatNormalPrice(input: {
  priceListCode: string;
  configuredAmount?: number;
  legacyPrices: LegacyProductPrices;
}): ResolvedNormalPrice {
  if (input.configuredAmount !== undefined) {
    return {
      amount: input.configuredAmount,
      source: "PRICE_LIST",
      isMissing: false,
      usedRetailFallback: false,
    };
  }
  if (
    input.priceListCode === "WHOLESALE" ||
    input.priceListCode === "MEMBER" ||
    input.priceListCode === "RETAIL"
  ) {
    return {
      amount: resolveLegacyChatPrice(input.legacyPrices, input.priceListCode),
      source: "LEGACY_COMPATIBILITY",
      isMissing: false,
      usedRetailFallback: false,
    };
  }
  return { amount: 0, source: "MISSING", isMissing: true, usedRetailFallback: false };
}

/**
 * Compatibility resolver for the additive rollout.
 *
 * `configuredAmount === undefined` means no ProductPrice row exists. An explicit
 * zero is a real configured value for marketplace/member/wholesale lists. RETAIL
 * keeps its established STORE-only fallback to wholesale when its value is zero.
 */
export function resolveNormalPrice(input: {
  priceListCode: SystemPriceListCode | string;
  configuredAmount?: number;
  legacyPrices: LegacyProductPrices;
}): ResolvedNormalPrice {
  const { priceListCode, configuredAmount, legacyPrices } = input;

  if (configuredAmount !== undefined) {
    if (priceListCode === "RETAIL" && configuredAmount <= 0) {
      return {
        amount: legacyPrices.salePrice ?? 0,
        source: "PRICE_LIST",
        isMissing: false,
        usedRetailFallback: true,
      };
    }
    return {
      amount: configuredAmount,
      source: "PRICE_LIST",
      isMissing: false,
      usedRetailFallback: false,
    };
  }

  if (priceListCode === "WHOLESALE" || priceListCode === "MEMBER" || priceListCode === "RETAIL") {
    return {
      amount: resolveLegacySalePrice(legacyPrices, priceListCode),
      source: "LEGACY_COMPATIBILITY",
      isMissing: false,
      usedRetailFallback:
        priceListCode === "RETAIL" && (legacyPrices.retailPrice ?? 0) <= 0,
    };
  }

  return { amount: 0, source: "MISSING", isMissing: true, usedRetailFallback: false };
}
