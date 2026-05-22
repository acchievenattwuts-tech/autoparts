export const revalidate = 300;

import type { Metadata } from "next";
export const dynamic = "force-dynamic";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  CarFront,
  MessageCircle,
  PackageSearch,
  Phone,
  ShieldCheck,
} from "lucide-react";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import ProductCard from "@/components/shared/ProductCard";
import ScrollReveal from "@/components/shared/ScrollReveal";
import ProductPageViewReporter from "@/components/analytics/ProductPageViewReporter";
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
  getRelatedStorefrontProductsByCategory,
} from "@/lib/storefront-product";
import { getStorefrontDisplayPrices } from "@/lib/storefront-pricing";

interface Props {
  params: Promise<{
    productSlug: string;
  }>;
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

export async function generateStaticParams() {
  // Avoid product-wide DB fan-out during build; pages are generated on first hit
  // and kept fresh by the existing ISR window.
  return [];
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
  const [config, product] = await Promise.all([getSiteConfig(), getResolvedProductFromParams(params)]);
  const relatedProducts = await getRelatedStorefrontProductsByCategory({
    categoryId: product.categoryId,
    currentProductId: product.id,
  });

  const canonicalPath = getProductPath({
    category: product.category,
    product,
  });
  const canonicalUrl = absoluteUrl(canonicalPath);
  const description = buildStorefrontProductDescription(product);
  const displayPrices = getStorefrontDisplayPrices(product.salePrice);

  type FitmentRow = {
    modelName: string;
    submodel: string | null;
    yearStart: number | null;
    yearEnd: number | null;
    engineCode: string | null;
    engineSize: string | null;
    note: string | null;
  };

  const carBrandMap = new Map<string, FitmentRow[]>();
  for (const fitment of product.carModels) {
    const brandName = fitment.carModel.carBrand.name;
    if (!carBrandMap.has(brandName)) {
      carBrandMap.set(brandName, []);
    }
    carBrandMap.get(brandName)?.push({
      modelName: fitment.carModel.name,
      submodel: fitment.submodel,
      yearStart: fitment.yearStart,
      yearEnd: fitment.yearEnd,
      engineCode: fitment.engineCode,
      engineSize: fitment.engineSize,
      note: fitment.note,
    });
  }

  const groupedCars = Array.from(carBrandMap.entries());

  const formatYearRange = (start: number | null, end: number | null): string | null => {
    if (start && end) return `ปี ${start}-${end}`;
    if (start) return `ปี ${start} เป็นต้นไป`;
    if (end) return `ถึงปี ${end}`;
    return null;
  };

  const formatFitmentLine = (row: FitmentRow): string => {
    const segments: string[] = [];
    segments.push(row.submodel ? `${row.modelName} (${row.submodel})` : row.modelName);
    const year = formatYearRange(row.yearStart, row.yearEnd);
    if (year) segments.push(year);
    const engineParts = [row.engineCode, row.engineSize].filter((value): value is string => Boolean(value));
    if (engineParts.length > 0) segments.push(engineParts.join(" "));
    return segments.join(" · ");
  };
  const prepArticles = knowledgeArticles.filter((article) =>
    [
      "how-to-check-oem-part-number-before-ordering",
      "can-one-ac-part-fit-multiple-car-models",
      "how-to-compare-old-part-before-chatting-with-the-shop",
      "how-to-check-compressor-plug-pulley-and-mounting-points",
    ].includes(article.slug),
  );
  const compatibilitySummary =
    groupedCars.length > 0
      ? groupedCars
          .slice(0, 2)
          .map(([brandName, rows]) => `${brandName} ${rows.slice(0, 2).map((r) => r.modelName).join(", ")}`)
          .join(" | ")
      : "ให้ร้านช่วยเช็กจากรุ่นรถหรือรูปชิ้นงานเดิม";
  const inStock = product.stock > 0;
  const stockLabel = inStock ? "มีสินค้าในระบบ" : "กรุณายืนยันกับร้าน";
  const fitmentPreview = groupedCars.flatMap(([brandName, rows]) =>
    rows.map((row) => ({
      brandName,
      label: formatFitmentLine(row),
      note: row.note,
    })),
  );
  const visibleFitments = fitmentPreview.slice(0, 5);
  const remainingFitmentCount = Math.max(fitmentPreview.length - visibleFitments.length, 0);
  const productImages = [
    ...product.images.map((image) => ({ url: image.url, alt: image.alt || product.name })),
    ...(product.imageUrl && !product.images.some((image) => image.url === product.imageUrl)
      ? [{ url: product.imageUrl, alt: product.name }]
      : []),
  ];
  const primaryImage = productImages[0] ?? null;

  return (
    <>
      <ProductPageViewReporter
        productId={product.id}
        productName={product.name}
        productCode={product.code}
        categoryName={product.category.name}
        brandName={product.brand?.name}
      />
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main className="min-h-screen overflow-hidden bg-[#f4f7fb] pt-16 text-[13px] text-[#10213d] sm:text-sm">
        <section className="relative">
          <div className="absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.20),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(16,33,61,0.16),transparent_34%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-2 sm:px-6 lg:px-8 lg:py-3">
            <nav className="mb-2 overflow-x-auto px-1 py-1">
              <ol className="flex min-w-max items-center gap-1.5 text-xs font-medium text-slate-500">
                <li>
                  <Link href="/" className="transition hover:text-[#10213d]">
                    หน้าแรก
                  </Link>
                </li>
                <li className="text-slate-300">/</li>
                <li>
                  <Link href="/products" className="inline-flex items-center gap-1 transition hover:text-[#10213d]">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    สินค้าทั้งหมด
                  </Link>
                </li>
                <li className="text-slate-300">/</li>
                <li>
                  <Link href={getCategoryPath(product.category)} className="transition hover:text-[#10213d]">
                    {product.category.name}
                  </Link>
                </li>
                <li className="text-slate-300">/</li>
                <li className="max-w-[42vw] truncate text-[#10213d] sm:max-w-sm">{product.name}</li>
              </ol>
            </nav>
            <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
              <div className="grid lg:grid-cols-[minmax(0,0.88fr)_minmax(420px,1fr)]">
                <div className="group relative overflow-hidden bg-gradient-to-br from-white via-slate-50 to-orange-50/40 lg:border-r lg:border-slate-200">
                  <div className="absolute left-5 top-5 z-10 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-[#10213d] shadow-sm">
                      {product.category.name}
                    </span>
                    {product.brand?.name && (
                      <span className="rounded-full bg-[#f97316]/12 px-3 py-1 text-xs font-bold text-[#f97316] shadow-sm">
                        {product.brand.name}
                      </span>
                    )}
                  </div>
                  <div className="relative min-h-[20rem] cursor-zoom-in overflow-hidden sm:min-h-[27rem] lg:min-h-[36rem]">
                    {primaryImage ? (
                      <Image
                        src={primaryImage.url}
                        alt={primaryImage.alt}
                        fill
                        sizes="(max-width: 1024px) 100vw, 45vw"
                        fetchPriority="high"
                        loading="eager"
                        className="object-contain object-top p-5 pt-14 transition-transform duration-700 ease-out group-hover:scale-[1.12] motion-reduce:transform-none motion-reduce:transition-none sm:p-7 sm:pt-16"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-300">
                        <PackageSearch className="h-20 w-20" />
                      </div>
                    )}
                  </div>
                  {productImages.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto border-t border-slate-200 bg-white/80 p-3">
                      {productImages.map((image, index) => (
                        <div
                          key={`${image.url}-${index}`}
                          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white"
                        >
                          <Image
                            src={image.url}
                            alt={image.alt || `${product.name} รูปที่ ${index + 1}`}
                            fill
                            sizes="64px"
                            className="object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 sm:p-5 lg:p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        inStock ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {stockLabel}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                      รหัส {product.code}
                    </span>
                  </div>

                  <h1 className="mt-3 font-kanit text-2xl font-bold leading-tight tracking-tight text-[#10213d] sm:text-3xl lg:text-4xl">
                    {product.name}
                  </h1>

                  <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>

                  <div className="mt-4 grid gap-2 sm:grid-cols-[0.95fr_1.05fr]">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">รหัสสินค้า</p>
                      <p className="mt-2 break-all text-xl font-extrabold text-[#10213d]">{product.code}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">แจ้งรหัสนี้ให้ร้านเช็กได้เร็วขึ้น</p>
                    </div>
                    <div className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">ราคาพิเศษ</p>
                      <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                        <p className="text-3xl font-black leading-none text-[#f97316]">
                          ฿{displayPrices.salePrice.toLocaleString("th-TH")}
                        </p>
                        <p className="pb-1 text-sm text-slate-400 line-through">
                          ฿{displayPrices.compareAtPrice.toLocaleString("th-TH")}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl bg-[#10213d] px-3 py-2.5 text-white">
                      <p className="text-xs text-white/60">หมวดสินค้า</p>
                      <p className="mt-1 line-clamp-1 font-semibold">{product.category.name}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                      <p className="text-xs text-slate-400">หน่วย</p>
                      <p className="mt-1 line-clamp-1 font-semibold text-slate-800">{product.reportUnitName}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                      <p className="text-xs text-slate-400">สถานะ</p>
                      <p className="mt-1 line-clamp-1 font-semibold text-slate-800">{stockLabel}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-kanit text-lg font-semibold text-[#10213d]">รุ่นรถที่เกี่ยวข้อง</p>
                        <p className="mt-1 text-sm text-slate-500">เช็กความเข้ากันได้ก่อนทักร้าน</p>
                      </div>
                      <CarFront className="h-5 w-5 shrink-0 text-[#f97316]" />
                    </div>
                    {visibleFitments.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {visibleFitments.map((fitment, index) => (
                          <div
                            key={`${fitment.brandName}-${fitment.label}-${index}`}
                            className="rounded-2xl bg-slate-50 px-3 py-2.5"
                          >
                            <p className="text-xs font-bold text-[#f97316]">{fitment.brandName}</p>
                            <p className="mt-0.5 text-sm leading-6 text-slate-700">{fitment.label}</p>
                            {fitment.note && <p className="mt-1 text-xs leading-5 text-slate-500">หมายเหตุ: {fitment.note}</p>}
                          </div>
                        ))}
                        {remainingFitmentCount > 0 && (
                          <a href="#fitment-list" className="inline-flex text-sm font-bold text-[#10213d] hover:text-[#f97316]">
                            ดูรุ่นที่เกี่ยวข้องทั้งหมดอีก {remainingFitmentCount.toLocaleString("th-TH")} รายการ
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                        หากยังไม่แน่ใจว่าสินค้านี้ตรงกับรถรุ่นใด สามารถส่งรุ่นรถหรือรูปอะไหล่เดิมให้ร้านช่วยตรวจสอบได้
                      </p>
                    )}
                  </div>

                  <div className="mt-4 rounded-[24px] bg-[#10213d] p-4 text-white shadow-[0_16px_34px_rgba(16,33,61,0.20)]">
                    <p className="text-sm font-semibold text-white/70">พร้อมให้ร้านเช็กสินค้านี้</p>
                    <p className="mt-1 text-base font-bold">ส่งรหัส {product.code} พร้อมรุ่นรถหรือรูปอะไหล่เดิม</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <a
                        href={config.shopLineUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sf-shine inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#06C755] px-5 py-3 font-bold text-white transition hover:bg-[#05a847]"
                      >
                        <MessageCircle className="h-4 w-4" />
                        สอบถามผ่าน LINE OA
                      </a>
                      {config.shopPhone && (
                        <a
                          href={`tel:${config.shopPhone}`}
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15"
                        >
                          <Phone className="h-4 w-4" />
                          โทรหาร้าน
                        </a>
                      )}
                    </div>
                  </div>
            </div>
            </div>
          </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.8fr)]">
            <div id="fitment-list" className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-3">
                <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                  <CarFront className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-kanit text-xl font-semibold text-[#10213d]">รุ่นรถที่เกี่ยวข้องทั้งหมด</h2>
                  <p className="mt-1 text-xs leading-6 text-slate-500">ใช้เป็นข้อมูลประกอบการเช็กอะไหล่ ควรยืนยันกับร้านอีกครั้งก่อนสั่ง</p>
                </div>
              </div>
              {groupedCars.length > 0 ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {groupedCars.map(([brandName, rows]) => (
                    <div key={brandName} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <p className="font-bold text-[#10213d]">{brandName}</p>
                      <div className="mt-2 space-y-2">
                        {rows.map((row, index) => (
                          <div key={`${row.modelName}-${index}`} className="border-l-2 border-[#f97316]/30 pl-3">
                            <p className="text-sm leading-6 text-slate-700">{formatFitmentLine(row)}</p>
                            {row.note && <p className="text-xs leading-5 text-slate-500">หมายเหตุ: {row.note}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  หากยังไม่แน่ใจว่าสินค้านี้ตรงกับรถรุ่นใด สามารถส่งรุ่นรถหรือรูปอะไหล่เดิมให้ร้านช่วยตรวจสอบได้
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                  <BadgeCheck className="h-5 w-5" />
                </div>
                <h2 className="mt-3 font-kanit text-xl font-semibold text-[#10213d]">ก่อนสั่งควรส่งอะไรให้ร้าน</h2>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <li>ส่งรหัสสินค้า {product.code} หรือชื่อสินค้า {product.name}</li>
                  <li>แจ้งยี่ห้อรถ รุ่นรถ ปีรถ และข้อมูลเครื่องยนต์ถ้ามี</li>
                  <li>ถ่ายรูปอะไหล่เดิม จุดยึด ปลั๊ก ท่อ หรือจุดสำคัญให้ร้านเทียบ</li>
                </ul>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="inline-flex rounded-2xl bg-[#10213d]/8 p-3 text-[#10213d]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h2 className="mt-3 font-kanit text-xl font-semibold text-[#10213d]">ข้อมูลอ้างอิง</h2>
                <dl className="mt-4 grid gap-2">
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">หมวดสินค้า</dt>
                    <dd className="mt-1 text-sm font-medium text-slate-700">{product.category.name}</dd>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">หน่วยแสดงผล</dt>
                    <dd className="mt-1 text-sm font-medium text-slate-700">{product.reportUnitName}</dd>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">รหัสอ้างอิง</dt>
                    <dd className="mt-1 break-all text-sm font-medium text-slate-700">{product.code}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </section>

        {product.aliases.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-kanit text-xl font-semibold text-[#10213d]">คำค้น / รหัสอ้างอิงที่เกี่ยวข้อง</h2>
                  <p className="mt-1 text-xs leading-6 text-slate-500">
                    ใช้เทียบชื่อเรียก รหัสเดิม หรือคำค้นที่ลูกค้าอาจใช้ค้นหาสินค้านี้
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
                  {product.aliases.length.toLocaleString("th-TH")} รายการ
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.aliases.map(({ alias }) => (
                  <span
                    key={alias}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600"
                  >
                    {alias}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-kanit text-xl font-semibold text-[#10213d]">
              บทความที่ช่วยเช็กความเข้ากันได้ก่อนสั่ง
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              ถ้ายังไม่มั่นใจเรื่องรหัสเดิม OEM รุ่นรถ หรือวิธีถ่ายรูปชิ้นงานเดิม สามารถอ่านคู่มือเหล่านี้ก่อนแล้วค่อยส่งข้อมูลให้ร้านยืนยันต่อได้
            </p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
              {prepArticles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/knowledge/${article.slug}`}
                  className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-1 hover:border-[#f97316]/40 hover:bg-white hover:shadow-lg motion-reduce:transform-none"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                    {article.category}
                  </p>
                  <h2 className="mt-3 font-kanit text-lg font-semibold leading-tight text-[#10213d]">
                    {article.title}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{article.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="font-kanit text-xl font-semibold text-[#10213d]">
                การยืนยันสินค้า
              </h2>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                หน้าเว็บช่วยให้ค้นหาสินค้าได้เร็วขึ้น แต่ก่อนสั่งซื้อจริงควรทัก LINE OA หรือโทรเข้าร้านเพื่อยืนยันสต็อก ความเข้ากันได้ของอะไหล่ และรายละเอียดล่าสุดอีกครั้ง
              </p>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="font-kanit text-xl font-semibold text-[#10213d]">
                สินค้านี้ช่วยคัดงานแบบไหน
              </h2>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                ถ้าคุณกำลังไล่ดูอะไหล่ในหมวด {product.category.name} หน้านี้ช่วยให้เช็กรายการที่ใกล้เคียงกับงานของคุณได้เร็วขึ้นจากชื่อสินค้า รหัสอ้างอิง และรุ่นรถที่เกี่ยวข้อง ก่อนคุยกับร้านเพื่อยืนยันสเปกจริงอีกครั้ง
              </p>
              <Link
                href={getCategoryPath(product.category)}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#10213d] transition hover:text-[#f97316]"
              >
                ดูสินค้าอื่นในหมวด {product.category.name}
              </Link>
            </div>
          </div>
        </section>

        {relatedProducts.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="font-kanit text-xl font-semibold text-[#10213d]">
                สินค้าใกล้เคียงในหมวดเดียวกัน
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                ถ้ายังต้องการเทียบหลายตัวก่อนสั่ง ลองเปิดดูสินค้าอื่นในหมวดเดียวกันแล้วส่งลิงก์หรือรหัสที่สงสัยให้ร้านช่วยเช็กต่อได้
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {relatedProducts.map((relatedProduct, index) => (
                  <ScrollReveal key={relatedProduct.id} delay={index * 50} className="h-full">
                    <ProductCard
                      product={relatedProduct}
                      lineUrl={config.shopLineUrl}
                    />
                  </ScrollReveal>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />

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
        categoryName={product.category.name}
        sellerName={config.shopName}
        additionalProperties={[
          { name: "หมวดสินค้า", value: product.category.name },
          { name: "รหัสสินค้า", value: product.code },
          { name: "หน่วยแสดงผล", value: product.reportUnitName },
          { name: "รุ่นรถที่เกี่ยวข้อง", value: compatibilitySummary },
        ]}
        relatedLinks={[
          absoluteUrl(getCategoryPath(product.category)),
          ...prepArticles.map((article) => absoluteUrl(`/knowledge/${article.slug}`)),
        ]}
      />
    </>
  );
};

export default ProductDetailPage;
