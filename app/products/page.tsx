export const revalidate = 300;

import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import ProductCard from "@/components/shared/ProductCard";
import DeferredFloatingLine from "@/components/shared/DeferredFloatingLine";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import ProductFilterBar from "./ProductFilterBar";
import ProductsHero from "./ProductsHero";
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
        <ProductsHero lineUrl={config.shopLineUrl} />

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
