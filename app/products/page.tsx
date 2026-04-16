export const revalidate = 300;

import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getPublicSiteConfig } from "@/lib/site-config";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import ProductCard from "@/components/shared/ProductCard";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import CollectionPageJsonLd from "@/components/seo/CollectionPageJsonLd";
import ProductFilterBar from "./ProductFilterBar";
import ProductFilterBarFallback from "./ProductFilterBarFallback";
import ProductsHero from "./ProductsHero";
import { absoluteUrl } from "@/lib/seo";
import { getProductPath } from "@/lib/product-slug";
import {
  getStorefrontProductFilters,
  getStorefrontProductsLandingPageData,
} from "@/lib/storefront-catalog";

const PRODUCTS_PER_PAGE = 24;

export const metadata: Metadata = {
  title: "อะไหล่แอร์รถยนต์ | สินค้าทั้งหมด",
  description:
    "รวมอะไหล่แอร์รถยนต์ คอมเพรสเซอร์ คอมแอร์ แผงคอนเดนเซอร์ หม้อน้ำ และสินค้าที่เกี่ยวข้อง พร้อมค้นหาและกรองสินค้าได้รวดเร็วก่อนส่งข้อมูลให้ร้านเช็กความตรงรุ่น",
  alternates: {
    canonical: absoluteUrl("/products"),
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    url: absoluteUrl("/products"),
    title: "อะไหล่แอร์รถยนต์ | สินค้าทั้งหมด",
    description:
      "รวมอะไหล่แอร์รถยนต์และสินค้าที่เกี่ยวข้อง พร้อมค้นหาและกรองสินค้าได้รวดเร็วก่อนเช็กกับร้าน",
  },
};

const ProductsPage = async () => {
  const [config, filterData, landingPageData] = await Promise.all([
    getPublicSiteConfig(),
    getStorefrontProductFilters(),
    getStorefrontProductsLandingPageData(),
  ]);
  const { products, totalProducts } = landingPageData;

  const pageEnd = Math.min(products.length, totalProducts);
  const totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCTS_PER_PAGE));

  return (
    <>
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
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
                        prefetchDetail={false}
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
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "สินค้าทั้งหมด", item: absoluteUrl("/products") },
        ]}
      />
      <CollectionPageJsonLd
        name="อะไหล่แอร์รถยนต์ | สินค้าทั้งหมด"
        description="หน้ารวมอะไหล่แอร์รถยนต์และสินค้าที่เกี่ยวข้องสำหรับใช้ค้นหาและส่งข้อมูลให้ร้านเช็กความตรงรุ่นก่อนสั่งซื้อ"
        url={absoluteUrl("/products")}
        itemListElements={products.slice(0, 12).map((product) => ({
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
    </>
  );
};

export default ProductsPage;
