export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import ProductCard from "@/components/shared/ProductCard";
import FloatingLine from "@/components/shared/FloatingLine";
import ProductFilterBar from "./ProductFilterBar";
import Image from "next/image";
import Link from "next/link";
import { buildProductSearchWhere } from "@/lib/product-search";

interface Props {
  searchParams: Promise<{ q?: string; category?: string; brand?: string; model?: string }>;
}

const ProductsPage = async ({ searchParams }: Props) => {
  const { q, category, brand, model } = await searchParams;
  const config = await getSiteConfig();

  const searchWhere = buildProductSearchWhere(q);

  const categoryWhere = category ? { category: { name: category } } : {};

  const brandModelWhere =
    brand && model
      ? { carModels: { some: { carModel: { name: model, carBrand: { name: brand } } } } }
      : brand
      ? { carModels: { some: { carModel: { carBrand: { name: brand } } } } }
      : {};

  const [products, categories, carBrands] = await Promise.all([
    db.product.findMany({
      where: { isActive: true, ...searchWhere, ...categoryWhere, ...brandModelWhere },
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
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        carModels: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
    }),
  ]);

  const hasFilter = q || category || brand || model;

  return (
    <>
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
        searchQuery={q}
      />
      <main className="min-h-screen bg-gray-50 pt-16">
        {/* Hero bar */}
        <div className="relative py-6 overflow-hidden">
          <Image
            src="/hero-banner.jpg"
            alt="hero background"
            fill
            sizes="100vw"
            className="object-cover object-center"
            priority
          />
          <div className="absolute inset-0 bg-[#0f2140]/55" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="font-kanit text-2xl font-bold text-white">สินค้าทั้งหมด</h1>
            {q && (
              <p className="text-white/70 text-sm mt-0.5">
                ผลการค้นหา: &ldquo;{q}&rdquo;
              </p>
            )}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Sidebar filters */}
            <aside className="w-full lg:w-72 shrink-0">
              <Suspense fallback={<div className="h-64 bg-white rounded-2xl animate-pulse" />}>
                <ProductFilterBar brands={carBrands} categories={categories} />
              </Suspense>
            </aside>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              {/* Result count */}
              <p className="text-sm text-gray-500 mb-4">
                {hasFilter ? (
                  <>
                    {q && <>ค้นหา &ldquo;{q}&rdquo;{" "}</>}
                    {brand && <>{brand}{model ? ` › ${model}` : ""}{" "}</>}
                    {category && <>{category}{" "}</>}
                    — พบ <span className="font-semibold text-gray-800">{products.length}</span> รายการ
                  </>
                ) : (
                  <>สินค้าทั้งหมด <span className="font-semibold text-gray-800">{products.length}</span> รายการ</>
                )}
              </p>

              {/* Products grid */}
              {products.length === 0 ? (
                <div className="text-center py-24 text-gray-400">
                  <p className="text-lg mb-2">ไม่พบสินค้าที่ค้นหา</p>
                  <Link href="/products" className="text-[#1e3a5f] text-sm underline">
                    ดูสินค้าทั้งหมด
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} lineUrl={config.shopLineUrl} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />
    </>
  );
};

export default ProductsPage;
