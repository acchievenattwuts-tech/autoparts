import { unstable_cache } from "next/cache";
import type { Prisma } from "@/lib/generated/prisma";
import { db, withDbRetry } from "@/lib/db";

/**
 * Data layer for the /home2 Shopee-style homepage.
 *
 * Every query here is read-only and cached, and reuses the same cache tags as
 * the live storefront ("storefront:products" / "storefront:categories") so an
 * admin edit invalidates home2 in the same revalidation round as "/". No page
 * outside /home2 imports this module.
 */

/** Page size of the "สินค้ามาใหม่" list — matches /products. */
export const NEW_ARRIVAL_PAGE_SIZE = 24;
/** Best-seller grid size. */
const BEST_SELLER_COUNT = 12;
/** Over-fetch so category diversification still fills the grid. */
const BEST_SELLER_POOL_SIZE = 48;
/** Keep one category from taking over the best-seller grid. */
const MAX_PER_CATEGORY = 3;
/** Fitment lines kept per card (the card renders at most two lines anyway). */
const FITMENT_TAKE = 4;

const ONE_DAY_SECONDS = 86_400;
const THIRTY_MINUTES_SECONDS = 1_800;

const STOREFRONT_PRODUCT_WHERE = {
  isActive: true,
  isStorefrontVisible: true,
  stock: { gt: 0 },
} satisfies Prisma.ProductWhereInput;

const HOME2_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  code: true,
  imageUrl: true,
  retailPrice: true,
  saleUnitName: true,
  warrantyDays: true,
  stock: true,
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { name: true } },
  carModels: {
    where: { fitmentType: "DIRECT", carModel: { isActive: true, carBrand: { isActive: true } } },
    orderBy: [{ carModel: { name: "asc" } }, { yearStart: "asc" }, { id: "asc" }],
    select: {
      yearStart: true,
      yearEnd: true,
      carModel: { select: { name: true, carBrand: { select: { name: true } } } },
    },
    take: FITMENT_TAKE,
  },
} satisfies Prisma.ProductSelect;

type Home2ProductRow = Prisma.ProductGetPayload<{ select: typeof HOME2_CARD_SELECT }>;

/** Plain, cache-serialisable shape consumed by the home2 card components. */
export interface Home2ProductCardData {
  id: string;
  name: string;
  code: string;
  slug: string | null;
  imageUrl: string | null;
  /** Raw retail price — 0 means "not priced yet" → card shows สอบถามราคา. */
  retailPrice: number;
  saleUnitName: string;
  warrantyDays: number;
  stock: number;
  category: { id: string; name: string; slug: string | null };
  brandName: string | null;
  /** e.g. "TOYOTA - VIOS 2013-2017, TOYOTA - YARIS 2014+" */
  fitmentSummary: string | null;
}

export interface Home2CategoryData {
  id: string;
  name: string;
  slug: string | null;
  productCount: number;
  /** Best-selling in-stock product's photo, used as the category thumbnail. */
  imageUrl: string | null;
}

const formatFitmentYear = (yearStart: number | null, yearEnd: number | null): string | null => {
  if (yearStart && yearEnd) return `${yearStart}-${yearEnd}`;
  if (yearStart) return `${yearStart}+`;
  if (yearEnd) return `ถึง ${yearEnd}`;
  return null;
};

/**
 * Same rule the live ProductCard uses: summarise only the first car brand so a
 * part fitting many brands does not render an unreadable wall of text.
 */
const buildFitmentSummary = (fitments: Home2ProductRow["carModels"]): string | null => {
  if (fitments.length === 0) return null;

  const firstBrand = fitments[0].carModel.carBrand.name;
  const labels = fitments
    .filter(({ carModel }) => carModel.carBrand.name === firstBrand)
    .map((fitment) => {
      const year = formatFitmentYear(fitment.yearStart, fitment.yearEnd);
      return `${firstBrand} - ${fitment.carModel.name}${year ? ` ${year}` : ""}`;
    });

  const summary = Array.from(new Set(labels)).join(", ");
  return summary || null;
};

const toCardData = (product: Home2ProductRow): Home2ProductCardData => ({
  id: product.id,
  name: product.name,
  code: product.code,
  slug: product.slug,
  imageUrl: product.imageUrl,
  retailPrice: Number(product.retailPrice),
  saleUnitName: product.saleUnitName,
  warrantyDays: product.warrantyDays,
  stock: product.stock,
  category: product.category,
  brandName: product.brand?.name ?? null,
  fitmentSummary: buildFitmentSummary(product.carModels),
});

const diversifyByCategory = (
  pool: readonly Home2ProductRow[],
  limit: number,
): Home2ProductRow[] => {
  const perCategory = new Map<string, number>();
  const picked: Home2ProductRow[] = [];
  const overflow: Home2ProductRow[] = [];

  for (const product of pool) {
    const used = perCategory.get(product.category.id) ?? 0;
    if (used < MAX_PER_CATEGORY) {
      perCategory.set(product.category.id, used + 1);
      picked.push(product);
    } else {
      overflow.push(product);
    }
    if (picked.length === limit) return picked;
  }

  // Not enough distinct categories to fill the grid — backfill so the row never
  // renders half-empty.
  for (const product of overflow) {
    picked.push(product);
    if (picked.length === limit) break;
  }

  return picked;
};

/**
 * Active categories with their live storefront product counts.
 */
export const getHome2Categories = unstable_cache(
  async (): Promise<Home2CategoryData[]> =>
    withDbRetry(async () => {
      const categories = await db.category.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { products: { where: { isActive: true, isStorefrontVisible: true } } } },
          // Prisma batches this nested read into one extra query keyed by
          // categoryId — it is not an N+1. Best-seller first so the thumbnail
          // is a part customers actually recognise.
          products: {
            where: { ...STOREFRONT_PRODUCT_WHERE, imageUrl: { not: null } },
            orderBy: { saleItems: { _count: "desc" } },
            select: { imageUrl: true },
            take: 1,
          },
        },
      });

      return categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        productCount: category._count.products,
        imageUrl: category.products[0]?.imageUrl ?? null,
      }));
    }),
  ["home2-categories"],
  { tags: ["storefront:categories"], revalidate: THIRTY_MINUTES_SECONDS },
);

/**
 * Best sellers ranked by lifetime sale-line count, capped per category.
 */
export const getHome2BestSellers = unstable_cache(
  async (): Promise<Home2ProductCardData[]> =>
    withDbRetry(async () => {
      const pool = await db.product.findMany({
        where: STOREFRONT_PRODUCT_WHERE,
        select: HOME2_CARD_SELECT,
        orderBy: { saleItems: { _count: "desc" } },
        take: BEST_SELLER_POOL_SIZE,
      });

      return diversifyByCategory(pool, BEST_SELLER_COUNT).map(toCardData);
    }),
  ["home2-best-sellers"],
  { tags: ["storefront:products"], revalidate: ONE_DAY_SECONDS },
);

export interface Home2ProductPage {
  products: Home2ProductCardData[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Newest arrivals, paginated — real createdAt order, no synthetic promo data.
 *
 * `createdAt` alone is not a total order (bulk imports share a timestamp), so
 * `id` breaks ties. Without it, skip/take could repeat or drop a row between
 * pages.
 */
const getHome2NewArrivalsPage = unstable_cache(
  async (page: number): Promise<Home2ProductPage> =>
    withDbRetry(async () => {
      const [products, total] = await Promise.all([
        db.product.findMany({
          where: STOREFRONT_PRODUCT_WHERE,
          select: HOME2_CARD_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * NEW_ARRIVAL_PAGE_SIZE,
          take: NEW_ARRIVAL_PAGE_SIZE,
        }),
        db.product.count({ where: STOREFRONT_PRODUCT_WHERE }),
      ]);

      return {
        products: products.map(toCardData),
        total,
        page,
        pageSize: NEW_ARRIVAL_PAGE_SIZE,
      };
    }),
  ["home2-new-arrivals"],
  { tags: ["storefront:products"], revalidate: ONE_DAY_SECONDS },
);

export const getHome2NewArrivals = (page = 1): Promise<Home2ProductPage> =>
  getHome2NewArrivalsPage(page);
