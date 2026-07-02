export const revalidate = 300;

import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/site-config";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import StorefrontTemporaryUnavailable from "@/components/shared/StorefrontTemporaryUnavailable";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import CollectionPageJsonLd from "@/components/seo/CollectionPageJsonLd";
import SearchResults from "./search/SearchResults";
import { absoluteUrl } from "@/lib/seo";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import { getProductPath } from "@/lib/product-slug";
import {
  getStorefrontProductFilters,
  getStorefrontProductsLandingPageData,
} from "@/lib/storefront-catalog";
import {
  getStorefrontProductSearchPageData,
  STOREFRONT_PRODUCTS_PER_PAGE,
  type SearchProductItem,
} from "@/lib/storefront-product-search";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import { isLikelyBotUserAgent } from "@/lib/search-bot";
import { headers } from "next/headers";
import { isDatabaseConnectionExhaustionError } from "@/lib/db-errors";

type QueryValue = string | string[] | undefined;

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    brand?: string;
    model?: QueryValue;
    year?: string;
    page?: string;
    // Multi-select filter UI v2
    categories?: QueryValue;
    partsBrand?: QueryValue;
    carBrand?: QueryValue;
    yearMin?: string;
    yearMax?: string;
    priceMin?: string;
    priceMax?: string;
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

const parsePriceParam = (value?: string): number | null => {
  if (!value) return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const normalizeQueryValues = (value: QueryValue): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
};

const buildRenderNonce = (input: {
  q?: string;
  category?: string;
  brand?: string;
  models: string[];
  year: number | null;
  page: number;
  categories: string[];
  partsBrands: string[];
  carBrands: string[];
  yearMin: number | null;
  yearMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
  total: number;
  pageStart: number;
  pageEnd: number;
  totalPages: number;
  requiredTokenFallbackUsed?: boolean;
  requiredTokens?: string[];
}): string =>
  JSON.stringify({
    q: input.q ?? "",
    category: input.category ?? "",
    brand: input.brand ?? "",
    models: input.models,
    year: input.year,
    page: input.page,
    categories: input.categories,
    partsBrands: input.partsBrands,
    carBrands: input.carBrands,
    yearMin: input.yearMin,
    yearMax: input.yearMax,
    priceMin: input.priceMin,
    priceMax: input.priceMax,
    total: input.total,
    pageStart: input.pageStart,
    pageEnd: input.pageEnd,
    totalPages: input.totalPages,
    requiredTokenFallbackUsed: input.requiredTokenFallbackUsed ?? false,
    requiredTokens: input.requiredTokens ?? [],
  });

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
  const {
    q,
    category,
    brand,
    model,
    year,
    page,
    categories: categoriesParam,
    partsBrand: partsBrandParam,
    carBrand: carBrandParam,
    yearMin: yearMinParam,
    yearMax: yearMaxParam,
    priceMin: priceMinParam,
    priceMax: priceMaxParam,
  } = await searchParams;
  const models = normalizeQueryValues(model);
  const explicitYear = parseYearParam(year);
  const currentPage = parsePage(page);
  const categories = normalizeQueryValues(categoriesParam);
  const partsBrands = normalizeQueryValues(partsBrandParam);
  const carBrands = normalizeQueryValues(carBrandParam);
  const yearMin = parseYearParam(yearMinParam);
  const yearMax = parseYearParam(yearMaxParam);
  const priceMin = parsePriceParam(priceMinParam);
  const priceMax = parsePriceParam(priceMaxParam);
  const hasFilter = Boolean(
    q ||
      category ||
      brand ||
      models.length > 0 ||
      explicitYear ||
      currentPage > 1 ||
      categories.length > 0 ||
      partsBrands.length > 0 ||
      carBrands.length > 0 ||
      yearMin !== null ||
      yearMax !== null ||
      priceMin !== null ||
      priceMax !== null,
  );

  let config: Awaited<ReturnType<typeof getSiteConfig>> | null = null;
  let filterData: Awaited<ReturnType<typeof getStorefrontProductFilters>>;

  try {
    config = await getSiteConfig();
    filterData = await getStorefrontProductFilters();
  } catch (error) {
    if (!isDatabaseConnectionExhaustionError(error)) {
      throw error;
    }

    return <StorefrontTemporaryUnavailable config={config} title="หน้าสินค้ากำลังหนาแน่นชั่วคราว" />;
  }

  let initialProducts: SearchProductItem[];
  let initialTotal: number;
  let initialDidYouMean: string[] = [];
  let initialMeta: { pageStart: number; pageEnd: number; totalPages: number };
  let initialRequiredTokenFallback:
    | { requiredTokens: string[]; usedFallback: boolean }
    | undefined;

  if (!hasFilter) {
    // Landing mode: use ISR-cached landing data
    let landingData: Awaited<ReturnType<typeof getStorefrontProductsLandingPageData>>;

    try {
      landingData = await getStorefrontProductsLandingPageData();
    } catch (error) {
      if (!isDatabaseConnectionExhaustionError(error)) {
        throw error;
      }

      return <StorefrontTemporaryUnavailable config={config} title="หน้าสินค้ากำลังหนาแน่นชั่วคราว" />;
    }

    const { products, totalProducts } = landingData;
    initialProducts = products.map((p) => ({ ...p, salePrice: p.salePrice.toString() }));
    initialTotal = totalProducts;
    initialMeta = {
      pageStart: initialProducts.length > 0 ? 1 : 0,
      pageEnd: initialProducts.length,
      totalPages: Math.max(1, Math.ceil(totalProducts / STOREFRONT_PRODUCTS_PER_PAGE)),
    };
    initialRequiredTokenFallback = undefined;
  } else {
    // Search mode: route stays request-time, but repeated identical searches reuse
    // the cached page payload from the shared storefront search helper.
    const skip = (currentPage - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
    const telemetryInput = {
      query: q,
      isActive: true,
      isStorefrontVisible: true,
      categoryName: category,
      carBrandName: brand,
      carModelNames: models,
      fitmentYear: explicitYear,
      categoryNames: categories,
      brandIds: partsBrands,
      carBrandNames: carBrands,
      yearMin,
      yearMax,
      priceMin,
      priceMax,
      skip,
      take: STOREFRONT_PRODUCTS_PER_PAGE,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    } as const;

    let searchPageData: Awaited<ReturnType<typeof getStorefrontProductSearchPageData>>;

    try {
      searchPageData = await getStorefrontProductSearchPageData({
        q,
        category,
        brand,
        models,
        year: explicitYear,
        page: currentPage,
        categories,
        partsBrands,
        carBrands,
        yearMin,
        yearMax,
        priceMin,
        priceMax,
      });
    } catch (error) {
      if (!isDatabaseConnectionExhaustionError(error)) {
        throw error;
      }

      return <StorefrontTemporaryUnavailable config={config} title="หน้าค้นหาสินค้ากำลังหนาแน่นชั่วคราว" />;
    }

    await logProductSearchTelemetry({
      input: telemetryInput,
      resultCount: searchPageData.total,
      source: "storefront",
      path: "/products",
      isBot: isLikelyBotUserAgent((await headers()).get("user-agent")),
    }).catch((error) => {
      if (!isDatabaseConnectionExhaustionError(error)) {
        throw error;
      }
    });

    initialProducts = searchPageData.products;
    initialTotal = searchPageData.total;
    initialDidYouMean = searchPageData.didYouMean;
    initialMeta = {
      pageStart: searchPageData.pageStart,
      pageEnd: searchPageData.pageEnd,
      totalPages: searchPageData.totalPages,
    };
    initialRequiredTokenFallback = searchPageData.requiredTokenFallback;
  }

  const renderNonce = buildRenderNonce({
    q,
    category,
    brand,
    models,
    year: explicitYear,
    page: currentPage,
    categories,
    partsBrands,
    carBrands,
    yearMin,
    yearMax,
    priceMin,
    priceMax,
    total: initialTotal,
    pageStart: initialMeta.pageStart,
    pageEnd: initialMeta.pageEnd,
    totalPages: initialMeta.totalPages,
    requiredTokenFallbackUsed: initialRequiredTokenFallback?.usedFallback,
    requiredTokens: initialRequiredTokenFallback?.requiredTokens,
  });

  return (
    <>
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
        searchQuery={q}
        filterData={filterData}
      />
      <main className="min-h-screen bg-gray-50 pt-16">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <SearchResults
            renderNonce={renderNonce}
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
              categories,
              partsBrands,
              carBrands,
              yearMin,
              yearMax,
              priceMin,
              priceMax,
            }}
            initialMeta={initialMeta}
            initialRequiredTokenFallback={initialRequiredTokenFallback}
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
            image: product.imageUrl
              ? absoluteUrl(toProductImageCdnPath(product.imageUrl) ?? product.imageUrl)
              : undefined,
          }))}
        />
      )}
    </>
  );
};

export default ProductsPage;
