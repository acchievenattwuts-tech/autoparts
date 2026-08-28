import { db, withDbRetry } from "@/lib/db";
import type { SaleChannel } from "@/lib/generated/prisma";
import { resolveNormalPrice, type LegacyProductPrices, type ResolvedNormalPrice } from "./resolve-price";

export type ActivePriceListOption = {
  id: string;
  code: string;
  name: string;
  channel: SaleChannel | null;
  isSystem: boolean;
};

export const getActivePriceListOptions = (): Promise<ActivePriceListOption[]> =>
  withDbRetry(() =>
    db.priceList.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, channel: true, isSystem: true },
    }),
  );

/** Batch-load one Price List and all requested amounts in a single query. */
export async function loadPriceListAmounts(
  priceListId: string,
  productIds: readonly string[],
): Promise<{
  priceList: ActivePriceListOption | null;
  amountByProductId: Map<string, number>;
}> {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  const priceList = await withDbRetry(() =>
    db.priceList.findFirst({
      where: { id: priceListId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        channel: true,
        isSystem: true,
        productPrices: {
          where: { productId: { in: uniqueProductIds } },
          select: { productId: true, amount: true },
        },
      },
    }),
  );

  if (!priceList) return { priceList: null, amountByProductId: new Map() };
  const { productPrices, ...option } = priceList;
  return {
    priceList: option,
    amountByProductId: new Map(productPrices.map((row) => [row.productId, Number(row.amount)])),
  };
}

/** Pure adapter over a batch-loaded map; it never performs a per-product query. */
export function resolveBatchLoadedPrice(input: {
  productId: string;
  priceListCode: string;
  amountByProductId: ReadonlyMap<string, number>;
  legacyPrices: LegacyProductPrices;
}): ResolvedNormalPrice {
  return resolveNormalPrice({
    priceListCode: input.priceListCode,
    configuredAmount: input.amountByProductId.get(input.productId),
    legacyPrices: input.legacyPrices,
  });
}
