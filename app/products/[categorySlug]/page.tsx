export const revalidate = 300;

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import CollectionPageJsonLd from "@/components/seo/CollectionPageJsonLd";
import ProductCard from "@/components/shared/ProductCard";
import { db } from "@/lib/db";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";
import { getSiteConfig } from "@/lib/site-config";
import { getCategoryPath } from "@/lib/product-slug";
import {
  getActiveStorefrontCategoryBySlug,
  getStorefrontCategoryPageData,
} from "@/lib/storefront-category";

interface Props {
  params: Promise<{
    categorySlug: string;
  }>;
}

export async function generateStaticParams() {
  const categories = await db.category.findMany({
    where: { isActive: true },
    select: { name: true },
  });

  return categories.map((category) => ({
    categorySlug: category.name,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { categorySlug } = await params;
  const category = await getActiveStorefrontCategoryBySlug(categorySlug);
  const canonicalPath = getCategoryPath(category.name);
  const title = `${category.name} | อะไหล่แอร์รถยนต์ นครสวรรค์`;
  const description = `รวมสินค้าในหมวด ${category.name} จากร้านศรีวรรณ อะไหล่แอร์ ร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ในนครสวรรค์ พร้อมค้นหาและสอบถามร้านผ่าน LINE OA ได้ทันที`;

  return {
    title,
    description,
    keywords: Array.from(new Set([category.name, ...LOCAL_SEO_KEYWORDS])),
    alternates: {
      canonical: absoluteUrl(canonicalPath),
    },
    openGraph: {
      url: absoluteUrl(canonicalPath),
      title,
      description,
      images: [{ url: absoluteUrl(`${canonicalPath}/opengraph-image`), alt: category.name }],
    },
    twitter: {
      title,
      description,
      images: [absoluteUrl(`${canonicalPath}/opengraph-image`)],
    },
  };
}

const CategoryPage = async ({ params }: Props) => {
  const { categorySlug } = await params;
  const [config, categoryData] = await Promise.all([
    getSiteConfig(),
    getStorefrontCategoryPageData(categorySlug),
  ]);

  const { category, productCount, products } = categoryData;
  const canonicalPath = getCategoryPath(category.name);
  const canonicalUrl = absoluteUrl(canonicalPath);
  const description = `รวมสินค้าในหมวด ${category.name} สำหรับลูกค้าที่กำลังหาอะไหล่แอร์รถยนต์ หม้อน้ำรถยนต์ และอะไหล่ที่เกี่ยวข้องจากร้านในนครสวรรค์ พร้อมส่งข้อมูลให้ร้านช่วยเช็กต่อได้ทันที`;

  return (
    <>
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main className="min-h-screen bg-slate-50 pt-16">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-[#10213d]"
            >
              <ArrowLeft className="h-4 w-4" />
              กลับไปหน้าสินค้าทั้งหมด
            </Link>
          </div>
        </section>

        <section className="overflow-hidden bg-[#10213d]">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]">
            <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_320px] lg:items-end">
                <div className="max-w-3xl">
                  <p className="text-sm font-medium text-[#f97316]">หมวดสินค้าอะไหล่แอร์รถยนต์</p>
                  <h1 className="mt-2 font-kanit text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
                    {category.name}
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-white/75 sm:text-base">
                    {description}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                      href={`/products?category=${encodeURIComponent(category.name)}`}
                      className="inline-flex items-center gap-2 rounded-full bg-[#f97316] px-5 py-3 font-semibold text-white transition hover:bg-[#ea6c0a]"
                    >
                      ดูสินค้าในหมวดนี้
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <a
                      href={config.shopLineUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/15"
                    >
                      สอบถามร้านทาง LINE
                    </a>
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 text-white backdrop-blur-sm">
                  <div className="inline-flex rounded-2xl bg-[#f97316]/15 p-3 text-[#f97316]">
                    <Search className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-3xl font-bold">{productCount.toLocaleString()}</p>
                  <p className="mt-2 text-sm leading-7 text-white/70">
                    รายการสินค้าในหมวดนี้ เหมาะสำหรับลูกค้าที่ต้องการคัดผลลัพธ์ให้แคบลงก่อนส่งให้ร้านช่วยเช็กต่อ
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <div className="mb-6 flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                สินค้าแนะนำในหมวด {category.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                ถ้ายังไม่แน่ใจรุ่นที่ใช้ได้ ให้เปิดดูรายละเอียดสินค้าแล้วส่งลิงก์ต่อให้ร้านผ่าน LINE OA
              </p>
            </div>
            <Link
              href={`/products?category=${encodeURIComponent(category.name)}`}
              className="inline-flex items-center gap-2 self-start rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-[#10213d] transition hover:border-[#10213d]"
            >
              เปิดดูผลค้นหาแบบกรองหมวด
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {products.length === 0 ? (
            <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-16 text-center text-slate-500 shadow-sm">
              ยังไม่มีสินค้าที่เปิดใช้งานในหมวดนี้ตอนนี้
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} lineUrl={config.shopLineUrl} />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />

      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "สินค้าทั้งหมด", item: absoluteUrl("/products") },
          { name: category.name, item: canonicalUrl },
        ]}
      />
      <CollectionPageJsonLd
        name={`${category.name} | ${config.shopName}`}
        description={description}
        url={canonicalUrl}
      />
    </>
  );
};

export default CategoryPage;
