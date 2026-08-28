export const SYSTEM_PRICE_LISTS = [
  {
    id: "system-price-list-wholesale",
    code: "WHOLESALE",
    name: "ราคาขายส่ง",
    channel: null,
    legacyTier: "WHOLESALE",
    sortOrder: 10,
  },
  {
    id: "system-price-list-member",
    code: "MEMBER",
    name: "ราคาสมาชิก",
    channel: null,
    legacyTier: "MEMBER",
    sortOrder: 20,
  },
  {
    id: "system-price-list-retail",
    code: "RETAIL",
    name: "ราคาขายปลีก",
    channel: null,
    legacyTier: "RETAIL",
    sortOrder: 30,
  },
  {
    id: "system-price-list-shopee",
    code: "SHOPEE",
    name: "ราคา Shopee",
    channel: "SHOPEE",
    legacyTier: null,
    sortOrder: 40,
  },
  {
    id: "system-price-list-lazada",
    code: "LAZADA",
    name: "ราคา Lazada",
    channel: "LAZADA",
    legacyTier: null,
    sortOrder: 50,
  },
] as const;

export type SystemPriceList = (typeof SYSTEM_PRICE_LISTS)[number];
export type SystemPriceListCode = SystemPriceList["code"];
export type LegacyPriceTier = Exclude<SystemPriceList["legacyTier"], null>;
export type PriceListChannel = Exclude<SystemPriceList["channel"], null>;

export const SYSTEM_PRICE_LIST_BY_CODE = Object.fromEntries(
  SYSTEM_PRICE_LISTS.map((priceList) => [priceList.code, priceList]),
) as Record<SystemPriceListCode, SystemPriceList>;

export function getSystemPriceListForLegacyTier(tier: LegacyPriceTier): SystemPriceList {
  const priceList = SYSTEM_PRICE_LISTS.find((candidate) => candidate.legacyTier === tier);
  if (!priceList) throw new Error(`Missing system Price List for legacy tier ${tier}`);
  return priceList;
}

export function isPriceListCompatibleWithChannel(
  priceListChannel: PriceListChannel | null,
  saleChannel: "STORE" | PriceListChannel,
): boolean {
  if (saleChannel === "STORE") return priceListChannel === null;
  return priceListChannel === saleChannel;
}
