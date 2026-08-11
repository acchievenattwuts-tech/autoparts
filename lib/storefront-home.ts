import { unstable_cache } from "next/cache";
import type { Prisma } from "@/lib/generated/prisma";
import { db, withDbRetry } from "@/lib/db";
import {
  addThailandDays,
  getThailandDateKey,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

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
/** "ขายดีประจำสัปดาห์" grid size. */
const BEST_SELLER_COUNT = 12;
/** Rolling window, in days including today. */
const BEST_SELLER_WINDOW_DAYS = 7;
/**
 * How far back the top-up ranking may reach when the trailing week did not
 * produce enough sellers. Bounds the sale-line scan so it cannot grow with the
 * whole sales history — half a year is far more than the grid ever needs.
 */
const BEST_SELLER_FALLBACK_WINDOW_DAYS = 180;
/** Quick-search chips shown under the hero form. */
const POPULAR_MODEL_COUNT = 7;
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
export interface StorefrontProductCardData {
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

export interface StorefrontCarModelData {
  id: string;
  name: string;
  /** In-stock products that list this model as a direct fit. */
  productCount: number;
}

export interface StorefrontCategoryData {
  id: string;
  name: string;
  slug: string | null;
  productCount: number;
  /**
   * Category thumbnail: the admin-uploaded image when there is one, otherwise the
   * best-selling in-stock product's photo. Null renders a name-inferred icon.
   */
  imageUrl: string | null;
  /**
   * Where {@link imageUrl} came from, which decides how the tile draws it. An
   * uploaded thumbnail is a transparent cut-out laid over the decorative disc and
   * allowed to overflow it; a product photo is an opaque catalogue shot, so it is
   * clipped to the disc instead — a rectangle floating on the tile would read as
   * a bug.
   */
  imageSource: "category" | "product" | null;
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

const toCardData = (product: Home2ProductRow): StorefrontProductCardData => ({
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

/**
 * Active categories with their live storefront product counts and thumbnails.
 *
 * The admin-uploaded `Category.imageUrl` wins. The best-selling-product fallback
 * is the expensive part of this page — ordering by a related row count makes the
 * planner aggregate SaleItem per candidate product — so it runs as a second query
 * scoped to only the categories that still need a thumbnail, and is skipped
 * entirely once every category has an image of its own.
 */
export const getHomeCategories = unstable_cache(
  async (): Promise<StorefrontCategoryData[]> =>
    withDbRetry(async () => {
      const categories = await db.category.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          _count: { select: { products: { where: { isActive: true, isStorefrontVisible: true } } } },
        },
      });

      const idsNeedingThumbnail = categories
        .filter((category) => !category.imageUrl)
        .map((category) => category.id);

      const fallbackImageByCategoryId = new Map<string, string>();
      if (idsNeedingThumbnail.length > 0) {
        // Prisma batches the nested read into one extra query keyed by categoryId —
        // it is not an N+1. Best-seller first so the thumbnail is a part customers
        // actually recognise.
        const withFallback = await db.category.findMany({
          where: { id: { in: idsNeedingThumbnail } },
          select: {
            id: true,
            products: {
              where: { ...STOREFRONT_PRODUCT_WHERE, imageUrl: { not: null } },
              orderBy: { saleItems: { _count: "desc" } },
              select: { imageUrl: true },
              take: 1,
            },
          },
        });

        for (const category of withFallback) {
          const imageUrl = category.products[0]?.imageUrl;
          if (imageUrl) fallbackImageByCategoryId.set(category.id, imageUrl);
        }
      }

      return categories.map((category) => {
        const imageUrl = category.imageUrl ?? fallbackImageByCategoryId.get(category.id) ?? null;

        return {
          id: category.id,
          name: category.name,
          slug: category.slug,
          productCount: category._count.products,
          imageUrl,
          imageSource: category.imageUrl ? "category" : imageUrl ? "product" : null,
        } satisfies StorefrontCategoryData;
      });
    }),
  // -v3: the entry gained `imageSource`. Data Cache entries survive deploys, so a
  // stale payload would leave every tile on the clipped product-photo treatment
  // until it expired. A new key retires them at once.
  ["home2-categories-v3"],
  { tags: ["storefront:categories"], revalidate: THIRTY_MINUTES_SECONDS },
);

/** Ranks product ids by how many distinct bills contain them, highest first. */
const rankByBillCount = (lines: { productId: string; saleId: string }[]): string[] => {
  const billsByProduct = new Map<string, Set<string>>();

  for (const line of lines) {
    const bills = billsByProduct.get(line.productId);
    if (bills) {
      bills.add(line.saleId);
    } else {
      billsByProduct.set(line.productId, new Set([line.saleId]));
    }
  }

  return [...billsByProduct.entries()]
    // Ties are broken by product id so the order stays stable across renders —
    // with this shop's volume most products sit on a single bill.
    .sort(([leftId, leftBills], [rightId, rightBills]) =>
      rightBills.size - leftBills.size || leftId.localeCompare(rightId),
    )
    .map(([productId]) => productId);
};

/**
 * "ขายดีประจำสัปดาห์" — ranked by how many separate bills included the product
 * over the trailing week, so one bulk order cannot crown a product on its own.
 *
 * Cancelled bills are excluded. If the week did not produce enough sellers, the
 * grid is topped up with the leaders of a longer trailing window so it never
 * renders half-empty.
 *
 * Both rankings come from one scan of ACTIVE sale lines inside that longer
 * window: it is cheaper than two aggregate round trips, and it lets the count be
 * distinct-by-bill, which Prisma's groupBy cannot express. The window is what
 * keeps the scan — and its egress — bounded as the sales history grows.
 */
const getHome2WeeklyBestSellersForDate = unstable_cache(
  async (dateKey: string): Promise<StorefrontProductCardData[]> =>
    withDbRetry(async () => {
      const today = parseDateOnlyToStartOfDay(dateKey);
      const startOfWindow = (days: number) =>
        parseDateOnlyToStartOfDay(getThailandDateKey(addThailandDays(today, -(days - 1))));

      const windowStart = startOfWindow(BEST_SELLER_WINDOW_DAYS);
      const fallbackWindowStart = startOfWindow(BEST_SELLER_FALLBACK_WINDOW_DAYS);

      const lines = await db.saleItem.findMany({
        where: {
          sale: { status: "ACTIVE", saleDate: { gte: fallbackWindowStart } },
          product: STOREFRONT_PRODUCT_WHERE,
        },
        select: { productId: true, saleId: true, sale: { select: { saleDate: true } } },
      });

      const weeklyRanking = rankByBillCount(
        lines.filter((line) => line.sale.saleDate >= windowStart),
      );
      const picked = weeklyRanking.slice(0, BEST_SELLER_COUNT);

      if (picked.length < BEST_SELLER_COUNT) {
        const alreadyPicked = new Set(picked);
        for (const productId of rankByBillCount(lines)) {
          if (alreadyPicked.has(productId)) continue;
          picked.push(productId);
          if (picked.length === BEST_SELLER_COUNT) break;
        }
      }

      if (picked.length === 0) return [];

      const products = await db.product.findMany({
        where: { id: { in: picked } },
        select: HOME2_CARD_SELECT,
      });

      const rankById = new Map(picked.map((id, index) => [id, index]));
      return products
        .sort((left, right) => (rankById.get(left.id) ?? 0) - (rankById.get(right.id) ?? 0))
        .map(toCardData);
    }),
  ["home2-weekly-best-sellers"],
  { tags: ["storefront:products"], revalidate: ONE_DAY_SECONDS },
);

export const getHomeWeeklyBestSellers = (): Promise<StorefrontProductCardData[]> =>
  getHome2WeeklyBestSellersForDate(getThailandDateKey());

export interface StorefrontProductPage {
  products: StorefrontProductCardData[];
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
  async (page: number): Promise<StorefrontProductPage> =>
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

export const getHomeNewArrivals = (page = 1): Promise<StorefrontProductPage> =>
  getHome2NewArrivalsPage(page);

/**
 * Car models to offer as one-tap chips in the hero.
 *
 * Ranked by how many in-stock parts list the model as a direct fit. That is a
 * proxy for demand rather than a measurement of it — the shop stocks deepest
 * for the cars people actually bring in — and it has the practical advantage
 * that every chip is guaranteed to land on a non-empty result page.
 */
export const getHomePopularCarModels = unstable_cache(
  async (): Promise<StorefrontCarModelData[]> =>
    withDbRetry(async () => {
      const fitmentWhere = {
        fitmentType: "DIRECT",
        product: STOREFRONT_PRODUCT_WHERE,
      } satisfies Prisma.ProductFitmentWhereInput;

      const models = await db.carModel.findMany({
        where: {
          isActive: true,
          carBrand: { isActive: true },
          products: { some: fitmentWhere },
        },
        select: {
          id: true,
          name: true,
          _count: { select: { products: { where: fitmentWhere } } },
        },
      });

      return models
        .sort(
          (left, right) =>
            right._count.products - left._count.products || left.name.localeCompare(right.name),
        )
        .slice(0, POPULAR_MODEL_COUNT)
        .map((model) => ({
          id: model.id,
          name: model.name,
          productCount: model._count.products,
        }));
    }),
  ["home2-popular-car-models"],
  { tags: ["storefront:products"], revalidate: ONE_DAY_SECONDS },
);
