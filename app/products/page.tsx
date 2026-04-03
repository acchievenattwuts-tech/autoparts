export const revalidate = 300;

import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import ProductCard from "@/components/shared/ProductCard";
import DeferredFloatingLine from "@/components/shared/DeferredFloatingLine";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import ProductFilterBar from "./ProductFilterBar";
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
  return query ? `/products?${query}` : "/products";
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q, category, brand, model, page } = await searchParams;

  const currentPage = parsePage(page);
  const activeFilters = [category, brand, model].filter(Boolean);
  const hasSearchState = Boolean(q || activeFilters.length > 0 || currentPage > 1);
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
    robots: hasSearchState
      ? {
          index: false,
          follow: true,
        }
      : {
          index: true,
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
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
        searchQuery={q}
      />
      <main className="min-h-screen bg-gray-50 pt-16">
        <div className="overflow-hidden bg-[#10213d]">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <h1 className="mt-2 font-kanit text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
                    ค้นหาอะไหล่ให้เจอเร็วขึ้น จากชื่อสินค้า รหัสอะไหล่ รุ่นรถ และคำที่ลูกค้าใช้เรียก
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
                    ค้นหาได้ทั้งอะไหล่แอร์ หม้อน้ำ คอมเพรสเซอร์ แผงคอนเดนเซอร์ และสินค้าเกี่ยวข้องจากหน้าเดียว
                  </p>
                </div>

                <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
                  <form action="/products" method="GET" className="space-y-3">
                    <input type="hidden" name="category" value={category ?? ""} />
                    <input type="hidden" name="brand" value={brand ?? ""} />
                    <input type="hidden" name="model" value={model ?? ""} />
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <label className="sr-only" htmlFor="products-hero-search">
                        ค้นหาสินค้า
                      </label>
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          id="products-hero-search"
                          type="text"
                          name="q"
                          defaultValue={q ?? ""}
                          placeholder="เช่น คอมแอร์ Denso, VIGO, แผงคอนเดนเซอร์..."
                          className="h-12 w-full rounded-2xl border border-white/20 bg-white px-11 text-sm text-slate-900 outline-none transition focus:border-[#f97316] focus:ring-4 focus:ring-[#f97316]/15"
                        />
                      </div>
                      <button
                        type="submit"
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#f97316] px-5 font-semibold text-white transition hover:bg-[#ea6c0a] sm:min-w-[150px]"
                      >
                        ค้นหาสินค้า
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-xs text-white/60 sm:text-sm">
                      ค้นหาแล้วกดเข้าไปดูรายละเอียดหรือสอบถามร้านผ่าน LINE OA ได้ทันที
                    </p>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row">
            <aside className="w-full shrink-0 lg:w-72">
              <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white" />}>
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
                    {sortedProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        lineUrl={config.shopLineUrl}
                      />
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
      <DeferredFloatingLine lineUrl={config.shopLineUrl} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "สินค้าทั้งหมด", item: absoluteUrl("/products") },
        ]}
      />
    </>
  );
};

export default ProductsPage;
