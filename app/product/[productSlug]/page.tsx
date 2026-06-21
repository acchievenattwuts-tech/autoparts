export const revalidate = 300;

import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ArrowLeft,
  CarFront,
  CheckCircle2,
  FileText,
  MessageCircle,
  Phone,
} from "lucide-react";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import ProductImageGallery from "@/components/shared/ProductImageGallery";
import StorefrontTemporaryUnavailable from "@/components/shared/StorefrontTemporaryUnavailable";
import RelatedProductsSection from "./RelatedProductsSection";
import ProductPageViewReporter from "@/components/analytics/ProductPageViewReporter";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import ProductJsonLd from "@/components/seo/ProductJsonLd";
import { absoluteUrl } from "@/lib/seo";
import { toProductImageCdnPath } from "@/lib/product-image-url";
import { getSiteConfig } from "@/lib/site-config";
import { knowledgeArticles } from "@/lib/knowledge-content";
import {
  extractProductIdFromSlug,
  getCategoryPath,
  getProductPath,
  shouldRedirectToCanonicalProductPath,
} from "@/lib/product-slug";
import {
  buildStorefrontProductDescription,
  getActiveStorefrontProductById,
  getRelatedStorefrontProductsByCategory,
} from "@/lib/storefront-product";
import { getStorefrontDisplayPrices } from "@/lib/storefront-pricing";
import {
  partitionProductFitments,
  PRODUCT_FITMENT_SECTION_COPY,
} from "@/lib/product-fitment";
import { isDatabaseConnectionExhaustionError } from "@/lib/db-errors";

interface Props {
  params: Promise<{
    productSlug: string;
  }>;
}

const getResolvedProductBySlug = cache(async (productSlug: string) => {
  const productId = extractProductIdFromSlug(productSlug);

  if (!productId) {
    notFound();
  }

  const product = await getActiveStorefrontProductById(productId);

  if (!product) {
    notFound();
  }

  return product;
});

async function getResolvedProductFromParams(paramsPromise: Props["params"]) {
  const { productSlug } = await paramsPromise;
  return getResolvedProductBySlug(productSlug);
}

export async function generateStaticParams() {
  // Avoid product-wide DB fan-out during build; pages are generated on first hit
  // and kept fresh by the existing ISR window.
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  let product: Awaited<ReturnType<typeof getResolvedProductFromParams>>;

  try {
    product = await getResolvedProductFromParams(params);
  } catch (error) {
    if (!isDatabaseConnectionExhaustionError(error)) {
      throw error;
    }

    return {
      title: "หน้าสินค้ากำลังหนาแน่นชั่วคราว",
      robots: { index: false, follow: true },
    };
  }

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
  const { productSlug } = await params;
  let config: Awaited<ReturnType<typeof getSiteConfig>> | null = null;
  let product: Awaited<ReturnType<typeof getResolvedProductFromParams>>;

  try {
    config = await getSiteConfig();
    product = await getResolvedProductBySlug(productSlug);
  } catch (error) {
    if (!isDatabaseConnectionExhaustionError(error)) {
      throw error;
    }

    return <StorefrontTemporaryUnavailable config={config} />;
  }

  const canonicalPath = getProductPath({
    category: product.category,
    product,
  });
  const requestedPath = `/product/${decodeURIComponent(productSlug)}`;
  if (
    shouldRedirectToCanonicalProductPath({
      requestedPath,
      canonicalPath,
    })
  ) {
    permanentRedirect(canonicalPath);
  }

  const INITIAL_TAKE = 8;
  let relatedProductsRaw: Awaited<ReturnType<typeof getRelatedStorefrontProductsByCategory>>;

  try {
    relatedProductsRaw = await getRelatedStorefrontProductsByCategory({
      categoryId: product.categoryId,
      currentProductId: product.id,
    });
  } catch (error) {
    if (!isDatabaseConnectionExhaustionError(error)) {
      throw error;
    }

    relatedProductsRaw = [];
  }
  const initialHasMore = relatedProductsRaw.length > INITIAL_TAKE;
  const relatedProducts = relatedProductsRaw.slice(0, INITIAL_TAKE).map((p) => ({
    ...p,
    salePrice: p.salePrice.toString(),
  }));
  const canonicalUrl = absoluteUrl(canonicalPath);
  const description = buildStorefrontProductDescription(product);
  const displayPrices = getStorefrontDisplayPrices(product.salePrice);

  type FitmentRow = {
    fitmentType: string;
    modelName: string;
    submodel: string | null;
    yearStart: number | null;
    yearEnd: number | null;
    engineCode: string | null;
    engineSize: string | null;
    note: string | null;
  };

  const fitmentRows = product.carModels.map((fitment) => ({
    fitmentType: fitment.fitmentType,
    modelName: fitment.carModel.name,
    submodel: fitment.submodel,
    yearStart: fitment.yearStart,
    yearEnd: fitment.yearEnd,
    engineCode: fitment.engineCode,
    engineSize: fitment.engineSize,
    note: fitment.note,
    brandName: fitment.carModel.carBrand.name,
  }));
  const fitmentGroups = partitionProductFitments(fitmentRows);
  const groupCarsByBrand = (rows: Array<FitmentRow & { brandName: string }>) => {
    const carBrandMap = new Map<string, FitmentRow[]>();

    for (const row of rows) {
      if (!carBrandMap.has(row.brandName)) {
        carBrandMap.set(row.brandName, []);
      }

      carBrandMap.get(row.brandName)?.push({
        fitmentType: row.fitmentType,
        modelName: row.modelName,
        submodel: row.submodel,
        yearStart: row.yearStart,
        yearEnd: row.yearEnd,
        engineCode: row.engineCode,
        engineSize: row.engineSize,
        note: row.note,
      });
    }

    return Array.from(carBrandMap.entries());
  };

  const groupedDirectCars = groupCarsByBrand(fitmentGroups.direct);
  const groupedCompatibleCars = groupCarsByBrand(fitmentGroups.compatible);
  const groupedCars = groupedDirectCars;

  const formatYearRange = (start: number | null, end: number | null): string | null => {
    if (start && end) return `ปี ${start}-${end}`;
    if (start) return `ปี ${start} เป็นต้นไป`;
    if (end) return `ถึงปี ${end}`;
    return null;
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
    groupedDirectCars.length > 0
      ? groupedDirectCars
          .slice(0, 2)
          .map(([brandName, rows]) => `${brandName} ${rows.slice(0, 2).map((r) => r.modelName).join(", ")}`)
          .join(" | ")
      : "ให้ร้านช่วยเช็กจากรุ่นรถหรือรูปชิ้นงานเดิม";
  const inStock = product.stock > 0;
  const stockLabel = inStock ? "มีสินค้าในระบบ" : "กรุณายืนยันกับร้าน";
  const partsBrandName = product.brand?.name ?? "ไม่ระบุแบรนด์";
  const productImages = [
    ...product.images.map((image) => ({ url: image.url, alt: image.alt || product.name })),
    ...(product.imageUrl && !product.images.some((image) => image.url === product.imageUrl)
      ? [{ url: product.imageUrl, alt: product.name }]
      : []),
  ];
  const renderFitmentSection = (
    fitmentType: "DIRECT" | "COMPATIBLE",
    groupedCars: Array<[string, FitmentRow[]]>,
  ) => {
    if (groupedCars.length === 0) {
      return null;
    }

    const copy = PRODUCT_FITMENT_SECTION_COPY[fitmentType];

    return (
      <>
        <div className="my-5 border-t border-slate-100 sm:my-6" />

        <div className="flex items-start gap-3">
          <div className="inline-flex flex-shrink-0 rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
            <CarFront className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-kanit text-lg font-semibold text-[#10213d] sm:text-xl">
              {copy.storefrontTitle}
            </h2>
            <p className="mt-1 text-xs leading-6 text-slate-500 sm:text-sm">
              {copy.storefrontDescription}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groupedCars.map(([brandName, rows]) => (
            <div key={`${fitmentType}-${brandName}`} className="rounded-[22px] border border-orange-200 bg-white px-4 py-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
              <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-sm font-bold text-orange-700">
                {brandName}
              </span>
              <div className="mt-2 space-y-2">
                {rows.map((row, index) => {
                  const yearLabel = formatYearRange(row.yearStart, row.yearEnd);
                  const engineLabel = [row.engineCode, row.engineSize]
                    .filter((value): value is string => Boolean(value))
                    .join(" ");
                  const metaParts = [yearLabel, engineLabel].filter(
                    (value): value is string => Boolean(value),
                  );

                  return (
                    <div key={`${fitmentType}-${brandName}-${row.modelName}-${index}`} className="border-l-4 border-[#f97316] pl-3">
                      <p className="break-words text-lg font-bold leading-7 text-[#10213d]">
                        {row.submodel ? `${row.modelName} (${row.submodel})` : row.modelName}
                      </p>
                      {metaParts.length > 0 && (
                        <p className="break-words text-sm leading-6 text-slate-500">
                          {metaParts.join(" · ")}
                        </p>
                      )}
                      {row.note && (
                        <p className="break-words text-sm leading-6 text-slate-500">
                          หมายเหตุ: {row.note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

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
              <div className="grid lg:min-h-[600px] lg:grid-cols-[minmax(0,0.88fr)_minmax(420px,1fr)]">
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
                  <ProductImageGallery images={productImages} productName={product.name} />
                </div>

                <div className="flex h-full flex-col p-4 sm:p-5 lg:p-6">
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

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <p className="text-xs text-slate-400">หมวดสินค้า</p>
                      <p className="mt-1 line-clamp-1 font-semibold text-slate-800">{product.category.name}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <p className="text-xs text-slate-400">หน่วย</p>
                      <p className="mt-1 line-clamp-1 font-semibold text-slate-800">{product.saleUnitName || "-"}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <p className="text-xs text-slate-400">แบรนด์อะไหล่</p>
                      <p className="mt-1 line-clamp-1 font-semibold text-slate-800">{partsBrandName}</p>
                    </div>
                    <div
                      className={`rounded-2xl border px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.06)] ${
                        inStock ? "border-emerald-200 bg-emerald-50" : "border-orange-200 bg-orange-50"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                            inStock ? "bg-emerald-200 text-emerald-800" : "bg-orange-200 text-orange-800"
                          }`}
                        >
                          {inStock ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="text-xs font-black">!</span>}
                        </span>
                        <div className="min-w-0">
                          <p className={`text-xs font-bold ${inStock ? "text-emerald-700" : "text-orange-700"}`}>สถานะ</p>
                          <p className="mt-1 line-clamp-1 font-semibold text-slate-900">{stockLabel}</p>
                          <p className={`mt-0.5 text-xs font-semibold ${inStock ? "text-emerald-700" : "text-orange-700"}`}>
                            {inStock ? "พร้อมจำหน่าย" : "เช็กก่อนสั่งซื้อ"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative mt-4 overflow-hidden rounded-[24px] border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-5 shadow-[0_16px_40px_-14px_rgba(249,115,22,0.45)] ring-1 ring-orange-100/70 lg:mt-auto">
                    {/* Brand accent bar */}
                    <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-[#f97316] to-orange-400" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#f97316]">พร้อมให้ร้านเช็กสินค้านี้</p>
                    <p className="mt-1.5 text-lg font-bold leading-snug text-[#10213d] sm:text-xl">ส่งรหัส {product.code} พร้อมรุ่นรถหรือรูปอะไหล่เดิม</p>
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
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 font-bold text-[#10213d] transition hover:bg-slate-50"
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
          <div id="fitment-list" className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:p-7">
            <div className="flex items-start gap-3">
              <div className="inline-flex flex-shrink-0 rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-kanit text-lg font-semibold text-[#10213d] sm:text-xl">รายละเอียดสินค้า</h2>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-line break-words text-sm leading-7 text-slate-700">
              {product.description?.trim() || "สอบถามรายละเอียดเพิ่มเติมที่ร้านค่ะ"}
            </p>

            {groupedCars.length > 0 && (
              <>
                <div className="my-5 border-t border-slate-100 sm:my-6" />

                <div className="flex items-start gap-3">
                  <div className="inline-flex flex-shrink-0 rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                    <CarFront className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-kanit text-lg font-semibold text-[#10213d] sm:text-xl">ใช้กับรถรุ่นไหนได้บ้าง</h2>
                    <p className="mt-1 text-xs leading-6 text-slate-500 sm:text-sm">
                      ตัวนี้ใส่ได้กับรถรุ่นต่อไปนี้ ถ้าไม่แน่ใจทักร้านก่อนสั่งได้เลยค่ะ
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {groupedCars.map(([brandName, rows]) => (
                    <div key={brandName} className="rounded-[22px] border border-orange-200 bg-white px-4 py-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
                      <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-sm font-bold text-orange-700">
                        {brandName}
                      </span>
                      <div className="mt-2 space-y-2">
                        {rows.map((row, index) => {
                          const yearLabel = formatYearRange(row.yearStart, row.yearEnd);
                          const engineLabel = [row.engineCode, row.engineSize]
                            .filter((value): value is string => Boolean(value))
                            .join(" ");
                          const metaParts = [yearLabel, engineLabel].filter((value): value is string => Boolean(value));
                          return (
                            <div key={`${row.modelName}-${index}`} className="border-l-4 border-[#f97316] pl-3">
                              <p className="break-words text-lg font-bold leading-7 text-[#10213d]">
                                {row.submodel ? `${row.modelName} (${row.submodel})` : row.modelName}
                              </p>
                              {metaParts.length > 0 && (
                                <p className="break-words text-sm leading-6 text-slate-500">
                                  {metaParts.join(" · ")}
                                </p>
                              )}
                              {row.note && (
                                <p className="break-words text-sm leading-6 text-slate-500">หมายเหตุ: {row.note}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {renderFitmentSection("COMPATIBLE", groupedCompatibleCars)}
          </div>
        </section>

        {relatedProducts.length > 0 && (
          <RelatedProductsSection
            initialProducts={relatedProducts}
            initialHasMore={initialHasMore}
            categoryId={product.categoryId}
            currentProductId={product.id}
            lineUrl={config.shopLineUrl}
          />
        )}

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
                {product.aliases.map(({ alias }, index) => (
                  <span
                    key={`${alias}-${index}`}
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
        imageUrl={
          product.imageUrl
            ? absoluteUrl(toProductImageCdnPath(product.imageUrl) ?? product.imageUrl)
            : null
        }
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
          { name: "หน่วยขาย", value: product.saleUnitName || "-" },
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
