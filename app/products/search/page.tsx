export const revalidate = 300;

import type { Metadata } from "next";
// Keep search dynamic so query-driven catalog results do not go stale.
export const dynamic = "force-dynamic";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import ProductCard from "@/components/shared/ProductCard";
import ScrollReveal from "@/components/shared/ScrollReveal";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import ProductFilterBar from "../ProductFilterBar";
import ProductFilterBarFallback from "../ProductFilterBarFallback";
import ProductsHero from "../ProductsHero";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { absoluteUrl } from "@/lib/seo";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";

const PRODUCTS_PER_PAGE = 24;

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    brand?: string;
    model?: string;
    page?: string;
  }>;
}

const parsePage = (value?: string) => {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
};

const buildProductsHref = ({
  q,
  category,
  brand,
  model,
  page,
}: {
  q?: string;
  category?: string;
  brand?: string;
  model?: string;
  page?: number;
}) => {
  const params = new URLSearchParams();

  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (brand) params.set("brand", brand);
  if (model) params.set("model", model);
  if (page && page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/products/search?${query}` : "/products/search";
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q, category, brand, model, page } = await searchParams;

  const currentPage = parsePage(page);
  const activeFilters = [category, brand, model].filter(Boolean);
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
  const { q, category, brand, model, page } = await searchParams;
  const config = await getSiteConfig();
  const currentPage = parsePage(page);
  const hasSearchState = Boolean(q || category || brand || model || currentPage > 1);

  if (!hasSearchState) {
    redirect("/products");
  }

  const skip = (currentPage - 1) * PRODUCTS_PER_PAGE;

  const searchResult = await searchProductIds({
    query: q,
    isActive: true,
    categoryName: category,
    carBrandName: brand,
    carModelName: model,
    skip,
    take: PRODUCTS_PER_PAGE,
    order: "createdAtDesc",
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
  const hasFilter = q || category || brand || model;
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
          <div className="flex flex-col gap-6 lg:flex-row">
            <aside className="w-full shrink-0 lg:w-72">
              <Suspense fallback={<ProductFilterBarFallback />}>
                <ProductFilterBar
                  brands={filterData.carBrands}
                  categories={filterData.categories}
                />
              </Suspense>
            </aside>

            <div className="min-w-0 flex-1">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-500">
                  {hasFilter ? (
                    <>
                      {q && <>ค้นหา &ldquo;{q}&rdquo; </>}
                      {brand && (
                        <>
                          {brand}
                          {model ? ` › ${model}` : ""}{" "}
                        </>
                      )}
                      {category && <>{category} </>}
                      — พบ <span className="font-semibold text-gray-800">{searchResult.total}</span>{" "}
                      รายการ
                    </>
                  ) : (
                    <>
                      แสดงสินค้า <span className="font-semibold text-gray-800">{searchResult.total}</span>{" "}
                      รายการ
                    </>
                  )}
                </p>

                {searchResult.total > 0 && (
                  <p className="text-xs text-gray-400 sm:text-sm">
                    แสดง {pageStart}-{pageEnd} จาก {searchResult.total} รายการ
                  </p>
                )}
              </div>

              {sortedProducts.length === 0 ? (
                <div className="py-24 text-center text-gray-400">
                  <p className="mb-2 text-lg">ไม่พบสินค้าที่ค้นหา</p>
                  <Link href="/products" className="text-sm text-[#1e3a5f] underline">
                    ดูสินค้าทั้งหมด
                  </Link>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {sortedProducts.map((product, index) => (
                      <ScrollReveal key={product.id} delay={index * 40}>
                        <ProductCard
                          product={product}
                          lineUrl={config.shopLineUrl}
                          prefetchDetail={false}
                        />
                      </ScrollReveal>
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-8 flex flex-col gap-3 rounded-3xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
                      <p className="text-sm text-gray-500">
                        หน้า <span className="font-semibold text-gray-800">{currentPage}</span> จาก{" "}
                        <span className="font-semibold text-gray-800">{totalPages}</span>
                      </p>

                      <div className="flex items-center gap-3">
                        {currentPage > 1 ? (
                          <Link
                            href={buildProductsHref({
                              q,
                              category,
                              brand,
                              model,
                              page: currentPage - 1,
                            })}
                            className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-[#1e3a5f] transition hover:border-[#1e3a5f]"
                          >
                            หน้าก่อนหน้า
                          </Link>
                        ) : (
                          <span className="inline-flex items-center justify-center rounded-full border border-gray-100 px-4 py-2 text-sm font-semibold text-gray-300">
                            หน้าก่อนหน้า
                          </span>
                        )}

                        {currentPage < totalPages ? (
                          <Link
                            href={buildProductsHref({
                              q,
                              category,
                              brand,
                              model,
                              page: currentPage + 1,
                            })}
                            className="inline-flex items-center justify-center rounded-full bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#16304e]"
                          >
                            หน้าถัดไป
                          </Link>
                        ) : (
                          <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-300">
                            หน้าถัดไป
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
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


