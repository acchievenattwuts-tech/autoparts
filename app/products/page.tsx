export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import CollectionPageJsonLd from "@/components/seo/CollectionPageJsonLd";
import ProductsHero from "./ProductsHero";
import SearchResults from "./search/SearchResults";
import { absoluteUrl } from "@/lib/seo";
import { getProductPath } from "@/lib/product-slug";
import {
  getStorefrontProductFilters,
  getStorefrontProductsLandingPageData,
} from "@/lib/storefront-catalog";
import {
  searchProductIds,
  sortProductsByIds,
  suggestDidYouMean,
} from "@/lib/product-search";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import type { SearchProductItem } from "./search/search-products-actions";

const PRODUCTS_PER_PAGE = 24;

type QueryValue = string | string[] | undefined;

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    brand?: string;
    model?: QueryValue;
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
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
};

const normalizeQueryValues = (value: QueryValue): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q, category, brand, model, page } = await searchParams;
  const models = normalizeQueryValues(model);
  const currentPage = parsePage(page);
  const hasFilter = Boolean(q || category || brand || models.length > 0 || currentPage > 1);

  if (!hasFilter) {
    return {
      title: "อะไหล่แอร์รถยนต์ | สินค้าทั้งหมด",
      description:
        "รวมอะไหล่แอร์รถยนต์ คอมเพรสเซอร์ คอมแอร์ แผงคอนเดนเซอร์ หม้อน้ำ และสินค้าที่เกี่ยวข้อง พร้อมค้นหาและกรองสินค้าได้รวดเร็วก่อนส่งข้อมูลให้ร้านเช็กความตรงรุ่น",
      alternates: { canonical: absoluteUrl("/products") },
      robots: { index: true, follow: true },
      openGraph: {
        url: absoluteUrl("/products"),
        title: "อะไหล่แอร์รถยนต์ | สินค้าทั้งหมด",
        description:
          "รวมอะไหล่แอร์รถยนต์และสินค้าที่เกี่ยวข้อง พร้อมค้นหาและกรองสินค้าได้รวดเร็วก่อนเช็กกับร้าน",
      },
    };
  }

  const activeFilters = [category, brand, models.join(", ")].filter(Boolean);
  const titleParts = ["สินค้าทั้งหมด"];
  if (activeFilters.length > 0) titleParts.push(activeFilters.join(" | "));
  if (q) titleParts.push(`ค้นหา "${q}"`);
  if (currentPage > 1) titleParts.push(`หน้า ${currentPage}`);

  return {
    title: titleParts.join(" | "),
    description:
      "ค้นหาอะไหล่แอร์ คอมเพรสเซอร์ หม้อน้ำ แผงคอนเดนเซอร์ และสินค้าในร้านศรีวรรณ อะไหล่แอร์ พร้อมกรองตามหมวดหมู่ ยี่ห้อรถ และรุ่นรถ",
    alternates: { canonical: absoluteUrl("/products") },
    robots: { index: false, follow: true },
    openGraph: {
      url: absoluteUrl("/products"),
      title: titleParts.join(" | "),
      description: "รวมสินค้าอะไหล่แอร์และหม้อน้ำรถยนต์ พร้อมค้นหาและกรองสินค้าได้รวดเร็ว",
    },
  };
}

const ProductsPage = async ({ searchParams }: Props) => {
  const { q, category, brand, model, year, page } = await searchParams;
  const models = normalizeQueryValues(model);
  const explicitYear = parseYearParam(year);
  const currentPage = parsePage(page);
  const hasFilter = Boolean(
    q || category || brand || models.length > 0 || explicitYear || currentPage > 1,
  );

  const [config, filterData] = await Promise.all([
    getSiteConfig(),
    getStorefrontProductFilters(),
  ]);

  let initialProducts: SearchProductItem[];
  let initialTotal: number;
  let initialDidYouMean: string[] = [];
  let initialMeta: { pageStart: number; pageEnd: number; totalPages: number };

  if (!hasFilter) {
    // Landing mode: use ISR-cached landing data
    const { products, totalProducts } = await getStorefrontProductsLandingPageData();
    initialProducts = products.map((p) => ({ ...p, salePrice: p.salePrice.toString() }));
    initialTotal = totalProducts;
    initialMeta = {
      pageStart: initialProducts.length > 0 ? 1 : 0,
      pageEnd: initialProducts.length,
      totalPages: Math.max(1, Math.ceil(totalProducts / PRODUCTS_PER_PAGE)),
    };
  } else {
    // Search mode: dynamic query
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
      path: "/products",
    });

    const products = await db.product.findMany({
      where: {
        id: {
          in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"],
        },
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
    });

    const sorted = sortProductsByIds(products, searchResult.ids);
    initialProducts = sorted.map((p) => ({ ...p, salePrice: p.salePrice.toString() }));
    initialTotal = searchResult.total;
    initialDidYouMean =
      q && searchResult.total < 3 ? await suggestDidYouMean(q, 3) : [];
    const pageEnd = Math.min(skip + initialProducts.length, searchResult.total);
    initialMeta = {
      pageStart: initialTotal === 0 ? 0 : skip + 1,
      pageEnd,
      totalPages: Math.max(1, Math.ceil(initialTotal / PRODUCTS_PER_PAGE)),
    };
  }

  // Key derived from server-rendered URL params so SearchResults re-mounts
  // on real navigation (e.g. nav link → /products clears filter state),
  // but NOT on AJAX filter changes (those use history.replaceState, no re-render).
  const searchResultsKey = [
    q ?? "",
    brand ?? "",
    category ?? "",
    [...models].sort().join(","),
    String(currentPage),
  ].join("|");

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
            key={searchResultsKey}
            renderNonce={Date.now()}
            initialProducts={initialProducts}
            initialTotal={initialTotal}
            initialDidYouMean={initialDidYouMean}
            initialFilters={{
              q: q ?? "",
              brand: brand ?? "",
              models,
              category: category ?? "",
              year: explicitYear,
              page: currentPage,
            }}
            initialMeta={initialMeta}
            filterData={filterData}
            lineUrl={config.shopLineUrl}
            basePath="/products"
          />
        </div>
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "สินค้าทั้งหมด", item: absoluteUrl("/products") },
        ]}
      />
      {!hasFilter && (
        <CollectionPageJsonLd
          name="อะไหล่แอร์รถยนต์ | สินค้าทั้งหมด"
          description="หน้ารวมอะไหล่แอร์รถยนต์และสินค้าที่เกี่ยวข้องสำหรับใช้ค้นหาและส่งข้อมูลให้ร้านเช็กความตรงรุ่นก่อนสั่งซื้อ"
          url={absoluteUrl("/products")}
          itemListElements={initialProducts.slice(0, 12).map((product) => ({
            name: product.name,
            url: absoluteUrl(
              getProductPath({
                category: product.category,
                product,
              }),
            ),
            image: product.imageUrl ?? undefined,
          }))}
        />
      )}
    </>
  );
};

export default ProductsPage;
