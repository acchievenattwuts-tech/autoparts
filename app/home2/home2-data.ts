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
 * grid is topped up with all-time bill leaders so it never renders half-empty.
 *
 * Both rankings come from one scan of ACTIVE sale lines: the whole table is a
 * few hundred rows, so this is cheaper than two aggregate round trips, and it
 * lets the count be distinct-by-bill, which Prisma's groupBy cannot express.
 */
const getHome2WeeklyBestSellersForDate = unstable_cache(
  async (dateKey: string): Promise<Home2ProductCardData[]> =>
    withDbRetry(async () => {
      const windowStart = parseDateOnlyToStartOfDay(
        getThailandDateKey(addThailandDays(parseDateOnlyToStartOfDay(dateKey), -(BEST_SELLER_WINDOW_DAYS - 1))),
      );

      const lines = await db.saleItem.findMany({
        where: {
          sale: { status: "ACTIVE" },
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

export const getHome2WeeklyBestSellers = (): Promise<Home2ProductCardData[]> =>
  getHome2WeeklyBestSellersForDate(getThailandDateKey());

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
