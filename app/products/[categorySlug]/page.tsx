export const revalidate = 300;
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import CollectionPageJsonLd from "@/components/seo/CollectionPageJsonLd";
import ProductCard from "@/components/shared/ProductCard";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";
import { getSiteConfig } from "@/lib/site-config";
import { getCategoryPath, getProductPath } from "@/lib/product-slug";
import { knowledgeArticles } from "@/lib/knowledge-content";
import {
  getActiveStorefrontCategoryBySlug,
  getStorefrontCategoryPageData,
} from "@/lib/storefront-category";

export const dynamicParams = true;

interface Props {
  params: Promise<{
    categorySlug: string;
  }>;
}

const getCategorySupportArticles = (categoryName: string) => {
  const normalizedCategoryName = categoryName.toLowerCase();

  return [...knowledgeArticles]
    .map((article) => {
      const haystack = [
        article.title,
        article.description,
        article.intro,
        ...article.relatedSearches,
      ]
        .join(" ")
        .toLowerCase();

      const score =
        (haystack.includes(normalizedCategoryName) ? 3 : 0) +
        (article.category === "การเลือกซื้อ" ? 1 : 0);

      return { article, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ article }) => article);
};

export async function generateStaticParams() {
  // Avoid category-wide DB fan-out during build; pages are generated on first hit
  // and kept fresh by the existing ISR window.
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { categorySlug } = await params;
  const category = await getActiveStorefrontCategoryBySlug(categorySlug);
  const canonicalPath = getCategoryPath(category);
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

  const { category, products } = categoryData;
  const canonicalPath = getCategoryPath(category);
  const requestedPath = `/products/${decodeURIComponent(categorySlug)}`;
  const supportArticles = getCategorySupportArticles(category.name);

  if (requestedPath !== canonicalPath) {
    permanentRedirect(canonicalPath);
  }

  const canonicalUrl = absoluteUrl(canonicalPath);
  const description = `รวมสินค้าในหมวด ${category.name} สำหรับลูกค้าที่กำลังหาอะไหล่แอร์รถยนต์ หม้อน้ำรถยนต์ และอะไหล่ที่เกี่ยวข้องจากร้านในนครสวรรค์ พร้อมส่งข้อมูลให้ร้านช่วยเช็กต่อได้ทันที`;

  return (
    <>
      <StorefrontNavbar
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
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
              <div className="max-w-4xl">
                <p className="text-sm font-medium text-[#f97316]">หมวดสินค้าอะไหล่แอร์รถยนต์</p>
                <h1 className="mt-2 font-kanit text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
                  {category.name}
                </h1>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-white/75 sm:text-base">
                  {description}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    href={config.shopLineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
                  >
                    สอบถามร้านทาง LINE
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
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

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                หมวด {category.name} เหมาะกับการค้นหาแบบไหน
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
                หน้านี้เหมาะสำหรับลูกค้าที่เริ่มรู้แล้วว่ากำลังหาอะไหล่ในหมวด {category.name}
                และต้องการไล่ดูสินค้าที่ใกล้เคียงกันก่อนคุยกับร้าน หากยังไม่แน่ใจรุ่นรถ รหัสเดิม
                หรือความเข้ากันได้ ควรเปิดรายละเอียดสินค้าแล้วส่งข้อมูลให้ร้านช่วยเช็กอีกครั้ง
              </p>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                ก่อนทักร้านควรเตรียมข้อมูลอะไร
              </h2>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-600 sm:text-base">
                <li>ยี่ห้อรถ รุ่นรถ ปีรถ และรายละเอียดเครื่องยนต์ถ้ามี</li>
                <li>รหัสอะไหล่เดิม รูปชิ้นงานเดิม หรือจุดยึด ปลั๊ก และท่อที่เกี่ยวข้อง</li>
                <li>ลิงก์สินค้าหรือชื่อสินค้าที่เจอในหมวดนี้ เพื่อให้ร้านเช็กได้เร็วขึ้น</li>
              </ul>
            </div>
          </div>

          {supportArticles.length > 0 && (
            <div className="mt-6 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                คู่มือที่ช่วยเลือกสินค้าในหมวดนี้
              </h2>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {supportArticles.map((article) => (
                  <Link
                    key={article.slug}
                    href={`/knowledge/${article.slug}`}
                    className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 transition hover:border-slate-300 hover:bg-white"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                      {article.category}
                    </p>
                    <h3 className="mt-3 font-kanit text-xl font-semibold leading-tight text-[#10213d]">
                      {article.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{article.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />

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
        itemListElements={products.map((product) => ({
          name: product.name,
          url: absoluteUrl(
            getProductPath({
              category,
              product,
            }),
          ),
          image: product.imageUrl ?? undefined,
        }))}
      />
    </>
  );
};

export default CategoryPage;

