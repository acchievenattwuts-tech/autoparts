/**
 * The product-card payload public storefront grids send to the browser.
 *
 * Grids (category, search, /products landing, related products, featured) all
 * render `components/shared/ProductCard`, which shows the retail price and an
 * in-stock / out-of-stock badge — nothing else from the pricing or stock
 * columns. The rows these grids read carry more than that (the exact `stock`
 * count, and in older cached entries the wholesale `salePrice`), and whatever a
 * Server Component hands a Client Component, or a Server Action returns, is
 * serialized into the public response.
 *
 * So every row passes through {@link toStorefrontProductCardItem} before it
 * leaves the server. The mapper picks fields explicitly rather than spreading
 * the row: a cached entry written before a field was dropped from a `select`
 * still cannot carry that field to the browser.
 */

type DecimalLike = { toString(): string } | number | string;

export type StorefrontProductCardFitment = {
  yearStart: number | null;
  yearEnd: number | null;
  carModel: { name: string; carBrand: { name: string } };
};

export type StorefrontProductCardCategory = { name: string; slug: string | null };

/** Server-side row shape the mapper reads (never sent to the browser as-is). */
export type StorefrontProductCardSourceRow<C extends StorefrontProductCardCategory> = {
  id: string;
  slug: string | null;
  name: string;
  code: string;
  imageUrl: string | null;
  retailPrice: DecimalLike;
  saleUnitName: string | null;
  warrantyDays: number;
  stock: number;
  category: C;
  brand: { name: string } | null;
  carModels: StorefrontProductCardFitment[];
};

/** What the browser receives for one storefront product card. */
export type StorefrontProductCardItem<
  C extends StorefrontProductCardCategory = StorefrontProductCardCategory,
> = {
  id: string;
  slug: string | null;
  name: string;
  code: string;
  imageUrl: string | null;
  /** Decimal serialized to a string for the Server → Client boundary. */
  retailPrice: string;
  saleUnitName: string | null;
  warrantyDays: number;
  /** The card only distinguishes in stock from out of stock. */
  inStock: boolean;
  category: C;
  brand: { name: string } | null;
  carModels: StorefrontProductCardFitment[];
};

export const toStorefrontProductCardItem = <C extends StorefrontProductCardCategory>(
  row: StorefrontProductCardSourceRow<C>,
): StorefrontProductCardItem<C> => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  code: row.code,
  imageUrl: row.imageUrl,
  retailPrice: row.retailPrice.toString(),
  saleUnitName: row.saleUnitName,
  warrantyDays: row.warrantyDays,
  inStock: row.stock > 0,
  category: row.category,
  brand: row.brand,
  carModels: row.carModels,
});
