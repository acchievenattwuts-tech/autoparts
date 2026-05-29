export const revalidate = 300;

import type { Metadata } from "next";
// Keep search dynamic so query-driven catalog results do not go stale.
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import ProductsHero from "../ProductsHero";
import SearchResults from "./SearchResults";
import {
  searchProductIds,
  sortProductsByIds,
  suggestDidYouMean,
} from "@/lib/product-search";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import { absoluteUrl } from "@/lib/seo";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";
import type { SearchProductItem } from "./search-products-actions";

const PRODUCTS_PER_PAGE = 24;

type QueryValue = string | string[] | undefined;

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    brand?: string;
    model?: QueryValue;
    /** Optional explicit fitment year (Phase C Q4=C). Auto-detect happens inside the search engine if blank. */
    year?: string;
    page?: string;
  }>;
}

const parseYearParam = (value?: string): number | null => {
  if (!value) return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1900 || n > 2200) return null;
  return n;
};

const parsePage = (value?: string) => {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
};

const normalizeQueryValues = (value: QueryValue): string[] => {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return value ? [value] : [];
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q, category, brand, model, page } = await searchParams;
  const models = normalizeQueryValues(model);

  const currentPage = parsePage(page);
  const activeFilters = [category, brand, models.join(", ")].filter(Boolean);
  const titleParts = ["สินค้าทั้งหมด"];

  if (activeFilters.length > 0) {
    titleParts.push(activeFilters.join(" | "));
  }

  if (q) {
    titleParts.push(`ค้นหา "${q}"`);
  }

  if (currentPage > 1) {
    titleParts.push(`หน้า ${currentPage}`);
  }

  return {
    title: titleParts.join(" | "),
    description:
      "ค้นหาอะไหล่แอร์ คอมเพรสเซอร์ หม้อน้ำ แผงคอนเดนเซอร์ และสินค้าในร้านศรีวรรณ อะไหล่แอร์ พร้อมกรองตามหมวดหมู่ ยี่ห้อรถ และรุ่นรถ",
    alternates: {
      canonical: absoluteUrl("/products"),
    },
    robots: {
      index: false,
      follow: true,
    },
    openGraph: {
      url: absoluteUrl("/products"),
      title: titleParts.join(" | "),
      description:
        "รวมสินค้าอะไหล่แอร์และหม้อน้ำรถยนต์ พร้อมค้นหาและกรองสินค้าได้รวดเร็ว",
    },
  };
}

const ProductsPage = async ({ searchParams }: Props) => {
  const { q, category, brand, model, year, page } = await searchParams;
  const models = normalizeQueryValues(model);
  const explicitYear = parseYearParam(year);
  const config = await getSiteConfig();
  const currentPage = parsePage(page);
  const hasSearchState = Boolean(
    q || category || brand || models.length > 0 || explicitYear || currentPage > 1,
  );

  if (!hasSearchState) {
    redirect("/products");
  }

  const skip = (currentPage - 1) * PRODUCTS_PER_PAGE;

  const searchInput = {
    query: q,
    isActive: true,
    categoryName: category,
    carBrandName: brand,
    carModelNames: models,
    fitmentYear: explicitYear,
    skip,
    take: PRODUCTS_PER_PAGE,
    order: "createdAtDesc",
  } as const;

  const searchResult = await searchProductIds(searchInput);

  await logProductSearchTelemetry({
    input: searchInput,
    resultCount: searchResult.total,
    source: "storefront",
    path: "/products/search",
  });

  const [products, filterData] = await Promise.all([
    db.product.findMany({
      where: {
        id: { in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"] },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        imageUrl: true,
        salePrice: true,
        stock: true,
        reportUnitName: true,
        category: { select: { name: true, slug: true } },
        brand: { select: { name: true } },
        carModels: {
          select: {
            yearStart: true,
            yearEnd: true,
            carModel: {
              select: {
                name: true,
                carBrand: { select: { name: true } },
              },
            },
          },
          take: 6,
        },
      },
    }),
    getStorefrontProductFilters(),
  ]);

  const sortedProducts = sortProductsByIds(products, searchResult.ids);

  // Serialize Decimal -> string for client component
  const initialProducts: SearchProductItem[] = sortedProducts.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    code: p.code,
    imageUrl: p.imageUrl,
    salePrice: p.salePrice.toString(),
    stock: p.stock,
    reportUnitName: p.reportUnitName,
    category: p.category,
    brand: p.brand,
    carModels: p.carModels,
  }));

  // Phase Q4 — "Did you mean" suggestions when results are sparse/empty
  const didYouMean =
    q && searchResult.total < 3 ? await suggestDidYouMean(q, 3) : [];

  const totalPages = Math.max(1, Math.ceil(searchResult.total / PRODUCTS_PER_PAGE));
  const pageStart = searchResult.total === 0 ? 0 : skip + 1;
  const pageEnd = Math.min(skip + sortedProducts.length, searchResult.total);

  return (
    <>
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
        searchQuery={q}
      />
      <main className="min-h-screen bg-gray-50 pt-16">
        <ProductsHero />

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <SearchResults
            initialProducts={initialProducts}
            initialTotal={searchResult.total}
            initialDidYouMean={didYouMean}
            initialFilters={{
              q: q ?? "",
              brand: brand ?? "",
              models,
              category: category ?? "",
              year: explicitYear,
              page: currentPage,
            }}
            initialMeta={{
              pageStart,
              pageEnd,
              totalPages,
            }}
            filterData={filterData}
            lineUrl={config.shopLineUrl}
          />
        </div>
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "สินค้าทั้งหมด", item: absoluteUrl("/products") },
          { name: "ค้นหาสินค้า", item: absoluteUrl("/products/search") },
        ]}
      />
    </>
  );
};

export default ProductsPage;
