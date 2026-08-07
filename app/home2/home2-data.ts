import { unstable_cache } from "next/cache";
import type { Prisma } from "@/lib/generated/prisma";
import { db, withDbRetry } from "@/lib/db";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * Data layer for the /home2 Shopee-style homepage.
 *
 * Every query here is read-only and cached, and reuses the same cache tags as
 * the live storefront ("storefront:products" / "storefront:categories") so an
 * admin edit invalidates home2 in the same revalidation round as "/". No page
 * outside /home2 imports this module.
 */

/** Daily picks row — Shopee's flash-sale slot, filled with real products. */
const DAILY_PICK_COUNT = 10;
/** Candidate pool the daily picks are drawn from (ids only — cheap to scan). */
const DAILY_PICK_POOL_SIZE = 400;
/** Best-seller grid size. */
const BEST_SELLER_COUNT = 12;
/** Over-fetch so category diversification still fills the grid. */
const BEST_SELLER_POOL_SIZE = 48;
/** Keep one category from taking over the best-seller grid. */
const MAX_PER_CATEGORY = 3;
/** Trending search chips under the header search bar. */
const TRENDING_KEYWORD_COUNT = 8;
/** Fitment lines kept per card (the card renders at most two lines anyway). */
const FITMENT_TAKE = 4;

const ONE_DAY_SECONDS = 86_400;
const THIRTY_MINUTES_SECONDS = 1_800;
const ONE_HOUR_SECONDS = 3_600;

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
}

export interface Home2KeywordData {
  id: string;
  term: string;
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

/** FNV-1a — turns the Thailand date key into a stable 32-bit seed. */
const hashSeed = (value: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

/** mulberry32 — deterministic PRNG so the same day always yields the same picks. */
const createSeededRandom = (seed: number): (() => number) => {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** Partial Fisher-Yates: picks `count` items without bias, seeded by the day. */
const pickSeeded = <T>(items: readonly T[], count: number, seed: string): T[] => {
  const pool = [...items];
  const random = createSeededRandom(hashSeed(seed));
  const take = Math.min(count, pool.length);

  for (let index = 0; index < take; index += 1) {
    const swapWith = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[swapWith]] = [pool[swapWith], pool[index]];
  }

  return pool.slice(0, take);
};

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
        },
      });

      return categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        productCount: category._count.products,
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

/**
 * Newest arrivals — real createdAt order, no synthetic promo data.
 */
export const getHome2NewArrivals = unstable_cache(
  async (): Promise<Home2ProductCardData[]> =>
    withDbRetry(async () => {
      const products = await db.product.findMany({
        where: STOREFRONT_PRODUCT_WHERE,
        select: HOME2_CARD_SELECT,
        orderBy: { createdAt: "desc" },
        take: DAILY_PICK_COUNT,
      });

      return products.map(toCardData);
    }),
  ["home2-new-arrivals"],
  { tags: ["storefront:products"], revalidate: ONE_DAY_SECONDS },
);

/**
 * Ten products that rotate once per Thailand calendar day.
 *
 * The rotation is deterministic (seeded by the date key) rather than random per
 * request, so the cache entry stays stable for the whole day — every visitor on
 * a given day sees the same ten items, and the DB is touched twice per day at
 * most instead of once per render.
 */
const getHome2DailyPicksForDate = unstable_cache(
  async (dateKey: string): Promise<Home2ProductCardData[]> =>
    withDbRetry(async () => {
      const pool = await db.product.findMany({
        where: STOREFRONT_PRODUCT_WHERE,
        select: { id: true },
        orderBy: { code: "asc" },
        take: DAILY_PICK_POOL_SIZE,
      });

      if (pool.length === 0) return [];

      const pickedIds = pickSeeded(
        pool.map((product) => product.id),
        DAILY_PICK_COUNT,
        dateKey,
      );

      const products = await db.product.findMany({
        where: { id: { in: pickedIds } },
        select: HOME2_CARD_SELECT,
      });

      // `in` does not preserve order — restore the shuffled order so the row
      // layout also changes day to day, not just its contents.
      const orderById = new Map(pickedIds.map((id, index) => [id, index]));
      return products
        .sort((left, right) => (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0))
        .map(toCardData);
    }),
  ["home2-daily-picks"],
  { tags: ["storefront:products"], revalidate: ONE_DAY_SECONDS },
);

export const getHome2DailyPicks = (): Promise<Home2ProductCardData[]> =>
  getHome2DailyPicksForDate(getThailandDateKey());

/**
 * Popular search terms for the Shopee-style chips under the search bar.
 */
export const getHome2TrendingKeywords = unstable_cache(
  async (): Promise<Home2KeywordData[]> =>
    withDbRetry(() =>
      db.searchKeyword.findMany({
        where: { popularity: { gt: 0 } },
        orderBy: [{ popularity: "desc" }, { term: "asc" }],
        select: { id: true, term: true },
        take: TRENDING_KEYWORD_COUNT,
      }),
    ),
  ["home2-trending-keywords"],
  { revalidate: ONE_HOUR_SECONDS },
);
