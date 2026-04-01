export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import ProductCard from "@/components/shared/ProductCard";
import FloatingLine from "@/components/shared/FloatingLine";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import ProductFilterBar from "./ProductFilterBar";
import Image from "next/image";
import Link from "next/link";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { absoluteUrl } from "@/lib/seo";

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    brand?: string;
    model?: string;
  }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q, category, brand, model } = await searchParams;

  const activeFilters = [category, brand, model].filter(Boolean);
  const hasSearchState = Boolean(q || activeFilters.length > 0);
  const titleParts = ["สินค้าทั้งหมด"];

  if (activeFilters.length > 0) {
    titleParts.push(activeFilters.join(" | "));
  }

  if (q) {
    titleParts.push(`ค้นหา "${q}"`);
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
  const { q, category, brand, model } = await searchParams;
  const config = await getSiteConfig();

  const searchResult = await searchProductIds({
    query: q,
    isActive: true,
    categoryName: category,
    carBrandName: brand,
    carModelName: model,
    take: 200,
    order: "createdAtDesc",
  });

  const [products, categories, carBrands] = await Promise.all([
    db.product.findMany({
      where: {
        id: { in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"] },
      },
      select: {
        id: true,
        name: true,
        code: true,
        imageUrl: true,
        salePrice: true,
        stock: true,
        reportUnitName: true,
        category: { select: { name: true } },
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
    db.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        carModels: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        },
      },
    }),
  ]);

  const sortedProducts = sortProductsByIds(products, searchResult.ids);
  const hasFilter = q || category || brand || model;

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
        <div className="relative overflow-hidden py-6">
          <Image
            src="/hero-banner.jpg"
            alt="hero background"
            fill
            sizes="100vw"
            className="object-cover object-center"
            priority
          />
          <div className="absolute inset-0 bg-[#0f2140]/55" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="font-kanit text-2xl font-bold text-white">สินค้าทั้งหมด</h1>
            {q && (
              <p className="mt-0.5 text-sm text-white/70">
                ผลการค้นหา: &ldquo;{q}&rdquo;
              </p>
            )}
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row">
            <aside className="w-full shrink-0 lg:w-72">
              <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-white" />}>
                <ProductFilterBar brands={carBrands} categories={categories} />
              </Suspense>
            </aside>

            <div className="min-w-0 flex-1">
              <p className="mb-4 text-sm text-gray-500">
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
                    — พบ{" "}
                    <span className="font-semibold text-gray-800">{searchResult.total}</span>{" "}
                    รายการ
                  </>
                ) : (
                  <>
                    สินค้าทั้งหมด{" "}
                    <span className="font-semibold text-gray-800">{searchResult.total}</span>{" "}
                    รายการ
                  </>
                )}
              </p>

              {sortedProducts.length === 0 ? (
                <div className="py-24 text-center text-gray-400">
                  <p className="mb-2 text-lg">ไม่พบสินค้าที่ค้นหา</p>
                  <Link href="/products" className="text-sm text-[#1e3a5f] underline">
                    ดูสินค้าทั้งหมด
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {sortedProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      lineUrl={config.shopLineUrl}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />
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
