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
import { absoluteUrl } from "@/lib/seo";
import { getStorefrontProductFilters } from "@/lib/storefront-catalog";

const PRODUCTS_PER_PAGE = 24;

export const metadata: Metadata = {
  title: "สินค้าทั้งหมด | ศรีวรรณ อะไหล่แอร์",
  description:
    "รวมสินค้าอะไหล่แอร์ คอมเพรสเซอร์ หม้อน้ำ แผงคอนเดนเซอร์ และสินค้าในร้านศรีวรรณ อะไหล่แอร์ พร้อมค้นหาและกรองสินค้าได้รวดเร็ว",
  alternates: {
    canonical: absoluteUrl("/products"),
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    url: absoluteUrl("/products"),
    title: "สินค้าทั้งหมด | ศรีวรรณ อะไหล่แอร์",
    description:
      "รวมสินค้าอะไหล่แอร์และหม้อน้ำรถยนต์ พร้อมค้นหาและกรองสินค้าได้รวดเร็ว",
  },
};

const ProductsPage = async () => {
  const [config, filterData, products, totalProducts] = await Promise.all([
    getSiteConfig(),
    getStorefrontProductFilters(),
    db.product.findMany({
      where: { isActive: true },
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
      orderBy: { createdAt: "desc" },
      take: PRODUCTS_PER_PAGE,
    }),
    db.product.count({ where: { isActive: true } }),
  ]);

  const pageEnd = Math.min(products.length, totalProducts);
  const totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCTS_PER_PAGE));

  return (
    <>
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main className="min-h-screen bg-gray-50 pt-16">
        <div className="overflow-hidden bg-[#10213d]">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <h1 className="mt-2 font-kanit text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
                    รวมสินค้าอะไหล่แอร์และหม้อน้ำรถยนต์ พร้อมเข้าไปค้นหาต่อได้ทันที
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
                    หน้าเมนูสินค้านี้โหลดแบบคงที่เพื่อให้เข้าได้เร็วที่สุด ส่วนการค้นหาด้วยชื่อสินค้า รหัส รุ่นรถ หรือการกรองละเอียดจะพาไปหน้าค้นหาโดยตรง
                  </p>
                </div>

                <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-white/10 p-4 backdrop-blur-sm">
                  <form action="/products/search" method="GET" className="space-y-3">
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
                      ถ้าต้องการกรองตามยี่ห้อรถ รุ่นรถ หรือหมวดสินค้า ระบบจะพาไปหน้าค้นหาและตัวกรองแบบเต็มให้ทันที
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
                  แสดงสินค้าล่าสุด <span className="font-semibold text-gray-800">{totalProducts}</span> รายการ
                </p>

                {totalProducts > 0 && (
                  <p className="text-xs text-gray-400 sm:text-sm">
                    แสดง 1-{pageEnd} จาก {totalProducts} รายการ
                  </p>
                )}
              </div>

              {products.length === 0 ? (
                <div className="py-24 text-center text-gray-400">
                  <p className="mb-2 text-lg">ยังไม่มีสินค้าที่เปิดใช้งานในขณะนี้</p>
                  <Link href="/products/search" className="text-sm text-[#1e3a5f] underline">
                    ไปหน้าค้นหาสินค้า
                  </Link>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        lineUrl={config.shopLineUrl}
                      />
                    ))}
                  </div>

                  <div className="mt-8 flex flex-col gap-3 rounded-3xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-sm text-gray-500">
                      หน้า <span className="font-semibold text-gray-800">1</span> จาก{" "}
                      <span className="font-semibold text-gray-800">{totalPages}</span>
                    </p>

                    <div className="flex items-center gap-3">
                      <Link
                        href="/products/search"
                        className="inline-flex items-center justify-center rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-[#1e3a5f] transition hover:border-[#1e3a5f]"
                      >
                        เปิดหน้าค้นหาและตัวกรอง
                      </Link>

                      {totalPages > 1 && (
                        <Link
                          href="/products/search?page=2"
                          className="inline-flex items-center justify-center rounded-full bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#16304e]"
                        >
                          หน้าถัดไป
                        </Link>
                      )}
                    </div>
                  </div>
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
