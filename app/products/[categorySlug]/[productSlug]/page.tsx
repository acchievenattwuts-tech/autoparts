export const revalidate = 300;

import type { Metadata } from "next";
export const dynamic = "force-dynamic";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  CarFront,
  MessageCircle,
  PackageSearch,
  Phone,
  ShieldCheck,
} from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import DeferredFloatingLine from "@/components/shared/DeferredFloatingLine";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import ProductJsonLd from "@/components/seo/ProductJsonLd";
import { absoluteUrl } from "@/lib/seo";
import { getSiteConfig } from "@/lib/site-config";
import { knowledgeArticles } from "@/lib/knowledge-content";
import {
  extractProductIdFromSlug,
  getCategoryPath,
  getProductPath,
} from "@/lib/product-slug";
import {
  buildStorefrontProductDescription,
  getActiveStorefrontProductById,
} from "@/lib/storefront-product";

interface Props {
  params: Promise<{
    categorySlug: string;
    productSlug: string;
  }>;
}

export async function generateStaticParams() {
  // Avoid product-wide DB fan-out during build; pages are generated on first hit
  // and kept fresh by the existing ISR window.
  return [];
}

async function getResolvedProductFromParams(paramsPromise: Props["params"]) {
  const { productSlug } = await paramsPromise;
  const productId = extractProductIdFromSlug(productSlug);

  if (!productId) {
    notFound();
  }

  const product = await getActiveStorefrontProductById(productId);

  if (!product) {
    notFound();
  }

  return product;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getResolvedProductFromParams(params);
  const description = buildStorefrontProductDescription(product);

  const canonicalPath = getProductPath({
    category: product.category,
    product,
  });

  return {
    title: product.name,
    description,
    alternates: {
      canonical: absoluteUrl(canonicalPath),
    },
    openGraph: {
      url: absoluteUrl(canonicalPath),
      title: product.name,
      description,
      images: [{ url: absoluteUrl(`${canonicalPath}/opengraph-image`), alt: product.name }],
    },
    twitter: {
      title: product.name,
      description,
      images: [absoluteUrl(`${canonicalPath}/opengraph-image`)],
    },
  };
}

const ProductDetailPage = async ({ params }: Props) => {
  const [resolvedParams, config, product] = await Promise.all([
    params,
    getSiteConfig(),
    getResolvedProductFromParams(params),
  ]);

  const requestedPath = `/products/${decodeURIComponent(
    resolvedParams.categorySlug,
  )}/${decodeURIComponent(resolvedParams.productSlug)}`;

  const canonicalPath = getProductPath({
    category: product.category,
    product,
  });

  if (requestedPath !== canonicalPath) {
    permanentRedirect(canonicalPath);
  }

  const canonicalUrl = absoluteUrl(canonicalPath);
  const description = buildStorefrontProductDescription(product);

  const carBrandMap = new Map<string, string[]>();
  for (const { carModel } of product.carModels) {
    const brandName = carModel.carBrand.name;
    if (!carBrandMap.has(brandName)) {
      carBrandMap.set(brandName, []);
    }
    carBrandMap.get(brandName)?.push(carModel.name);
  }

  const groupedCars = Array.from(carBrandMap.entries());
  const prepArticles = knowledgeArticles.filter((article) =>
    [
      "how-to-check-oem-part-number-before-ordering",
      "can-one-ac-part-fit-multiple-car-models",
      "how-to-compare-old-part-before-chatting-with-the-shop",
      "how-to-check-compressor-plug-pulley-and-mounting-points",
    ].includes(article.slug),
  );

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

        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,0.85fr)]">
            <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
              <div className="relative aspect-[4/3] bg-gradient-to-br from-slate-100 via-slate-50 to-white">
                {product.imageUrl ? (
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    fill
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    fetchPriority="high"
                    loading="eager"
                    className="object-contain p-6 sm:p-10"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-300">
                    <PackageSearch className="h-20 w-20" />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-[#10213d]/8 px-3 py-1 text-xs font-semibold text-[#10213d]">
                    {product.category.name}
                  </span>
                  {product.brand?.name && (
                    <span className="rounded-full bg-[#f97316]/10 px-3 py-1 text-xs font-semibold text-[#f97316]">
                      {product.brand.name}
                    </span>
                  )}
                </div>

                <h1 className="mt-4 font-kanit text-3xl font-bold leading-tight text-[#10213d] sm:text-4xl">
                  {product.name}
                </h1>

                <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      รหัสสินค้า
                    </p>
                    <p className="mt-1 font-medium text-slate-800">{product.code}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      ราคา
                    </p>
                    <p className="mt-1 text-xl font-bold text-[#f97316]">
                      ฿{Number(product.salePrice).toLocaleString("th-TH")}
                    </p>
                  </div>
                </div>

                <div className="mt-5 rounded-3xl border border-slate-100 bg-slate-50 p-5">
                  <p className="text-sm leading-7 text-slate-600">{description}</p>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <a
                    href={config.shopLineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#06C755] px-5 py-3 font-semibold text-white transition hover:bg-[#05a847]"
                  >
                    <MessageCircle className="h-4 w-4" />
                    สอบถามผ่าน LINE OA
                  </a>
                  {config.shopPhone && (
                    <a
                      href={`tel:${config.shopPhone}`}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 font-semibold text-[#10213d] transition hover:border-[#10213d]"
                    >
                      <Phone className="h-4 w-4" />
                      โทรหาร้าน
                    </a>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                    <BadgeCheck className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 font-kanit text-2xl font-semibold text-[#10213d]">
                    การยืนยันสินค้า
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    หน้าเว็บช่วยให้ค้นหาสินค้าได้เร็วขึ้น แต่ก่อนสั่งซื้อจริงควรทัก LINE OA หรือโทรเข้าร้านเพื่อยืนยันสต็อก
                    ความเข้ากันได้ของอะไหล่ และรายละเอียดล่าสุดอีกครั้ง
                  </p>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="inline-flex rounded-2xl bg-[#10213d]/8 p-3 text-[#10213d]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 font-kanit text-2xl font-semibold text-[#10213d]">
                    ข้อมูลอ้างอิง
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    ใช้รหัสสินค้า ชื่อสินค้า รุ่นรถ หรือรูปอะไหล่เดิมส่งให้ร้านได้ เพื่อช่วยให้ร้านตรวจสอบและตอบกลับได้เร็วขึ้น
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">รายละเอียดสินค้า</h2>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    หมวดสินค้า
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-700">{product.category.name}</dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    หน่วยแสดงผล
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-700">
                    {product.reportUnitName}
                  </dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    สถานะสินค้า
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-700">
                    {product.stock > 0 ? "มีสินค้าในระบบ" : "กรุณายืนยันกับร้าน"}
                  </dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    รหัสอ้างอิง
                  </dt>
                  <dd className="mt-1 break-all text-sm font-medium text-slate-700">
                    {product.code}
                  </dd>
                </div>
              </dl>

              {product.aliases.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-kanit text-xl font-semibold text-[#10213d]">คำค้นที่เกี่ยวข้อง</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {product.aliases.map(({ alias }) => (
                      <span
                        key={alias}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                <CarFront className="h-5 w-5" />
              </div>
              <h2 className="mt-4 font-kanit text-2xl font-semibold text-[#10213d]">
                รุ่นรถที่เกี่ยวข้อง
              </h2>
              {groupedCars.length > 0 ? (
                <div className="mt-5 space-y-4">
                  {groupedCars.map(([brandName, models]) => (
                    <div key={brandName} className="rounded-2xl bg-slate-50 px-4 py-4">
                      <p className="font-semibold text-[#10213d]">{brandName}</p>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{models.join(", ")}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm leading-7 text-slate-600">
                  หากยังไม่แน่ใจว่าสินค้านี้ตรงกับรถรุ่นใด สามารถส่งรุ่นรถหรือรูปอะไหล่เดิมให้ร้านช่วยตรวจสอบได้
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
              บทความที่ช่วยเช็กความเข้ากันได้ก่อนสั่ง
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
              ถ้ายังไม่มั่นใจเรื่องรหัสเดิม OEM รุ่นรถ หรือวิธีถ่ายรูปชิ้นงานเดิม สามารถอ่านคู่มือเหล่านี้ก่อนแล้วค่อยส่งข้อมูลให้ร้านยืนยันต่อได้
            </p>
            <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {prepArticles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/knowledge/${article.slug}`}
                  className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 transition hover:border-slate-300 hover:bg-white"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                    {article.category}
                  </p>
                  <h2 className="mt-3 font-kanit text-xl font-semibold leading-tight text-[#10213d]">
                    {article.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{article.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer config={config} />
      <DeferredFloatingLine lineUrl={config.shopLineUrl} />

      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "สินค้าทั้งหมด", item: absoluteUrl("/products") },
          {
            name: product.category.name,
            item: absoluteUrl(getCategoryPath(product.category)),
          },
          { name: product.name, item: canonicalUrl },
        ]}
      />
      <ProductJsonLd
        name={product.name}
        description={description}
        imageUrl={product.imageUrl}
        brandName={product.brand?.name}
        sku={product.code}
        url={canonicalUrl}
        price={Number(product.salePrice)}
        inStock={product.stock > 0}
      />
    </>
  );
};

export default ProductDetailPage;
