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
            <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <h1 className="mt-1 font-kanit text-2xl font-bold leading-tight text-white sm:text-3xl lg:mt-2 lg:text-4xl">
                    รวมสินค้าอะไหล่แอร์และหม้อน้ำรถยนต์ พร้อมเข้าไปค้นหาต่อได้ทันที
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
                    หน้าเมนูสินค้านี้โหลดแบบคงที่เพื่อให้เข้าได้เร็วที่สุด ส่วนการค้นหาด้วยชื่อสินค้า รหัส รุ่นรถ หรือการกรองละเอียดจะพาไปหน้าค้นหาโดยตรง
                  </p>
                </div>

                <div className="w-full max-w-xl rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur-sm sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-white/12 p-3 text-white">
                      <Search className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-white sm:text-lg">
                        ค้นหาจากแถบด้านบน หรือใช้ตัวกรองด้านซ้าย
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/70">
                        บนมือถือให้เริ่มจากปุ่มค้นหาด้านล่าง หรือเลื่อนลงไปเปิดตัวกรองสินค้าได้ทันที
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2 sm:gap-3">
                    <Link
                      href="/products/search"
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#f97316] px-5 text-sm font-semibold text-white transition hover:bg-[#ea6c0a] sm:text-base"
                    >
                      เปิดหน้าค้นหาและตัวกรอง
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <a
                      href={config.shopLineUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/8 px-5 text-sm font-semibold text-white transition hover:bg-white/14"
                    >
                      ส่งรุ่นรถหรือรหัสให้ร้านช่วยเช็ก
                    </a>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/65">
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                      ค้นจากชื่อสินค้า
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                      ค้นจากรหัสสินค้า
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                      กรองตามยี่ห้อและรุ่นรถ
                    </span>
                  </div>
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
