export const revalidate = 300;

import type { Metadata } from "next";
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
  getProductSlug,
} from "@/lib/product-slug";
import {
  buildStorefrontProductDescription,
  getActiveStorefrontProductById,
} from "@/lib/storefront-product";
import { db } from "@/lib/db";

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
  const products = await db.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
    },
  });

  return products.map((product) => ({
    productSlug: getProductSlug(product),
  }));
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

  const canonicalPath = getProductPath({
    category: product.category,
    product,
  });
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
              เธเธฅเธฑเธเนเธเธซเธเนเธฒเธชเธดเธเธเนเธฒเธ—เธฑเนเธเธซเธกเธ”
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
                      เธฃเธซเธฑเธชเธชเธดเธเธเนเธฒ
                    </p>
                    <p className="mt-1 font-medium text-slate-800">{product.code}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      เธฃเธฒเธเธฒ
                    </p>
                    <p className="mt-1 text-xl font-bold text-[#f97316]">
                      เธฟ{Number(product.salePrice).toLocaleString("th-TH")}
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
                    เธชเธญเธเธ–เธฒเธกเธเนเธฒเธ LINE OA
                  </a>
                  {config.shopPhone && (
                    <a
                      href={`tel:${config.shopPhone}`}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 font-semibold text-[#10213d] transition hover:border-[#10213d]"
                    >
                      <Phone className="h-4 w-4" />
                      เนเธ—เธฃเธซเธฒเธฃเนเธฒเธ
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
                    เธเธฒเธฃเธขเธทเธเธขเธฑเธเธชเธดเธเธเนเธฒ
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    เธซเธเนเธฒเน€เธงเนเธเธเนเธงเธขเนเธซเนเธเนเธเธซเธฒเธชเธดเธเธเนเธฒเนเธ”เนเน€เธฃเนเธงเธเธถเนเธ เนเธ•เนเธเนเธญเธเธชเธฑเนเธเธเธทเนเธญเธเธฃเธดเธเธเธงเธฃเธ—เธฑเธ LINE OA เธซเธฃเธทเธญเนเธ—เธฃเน€เธเนเธฒเธฃเนเธฒเธเน€เธเธทเนเธญเธขเธทเธเธขเธฑเธเธชเธ•เนเธญเธ
                    เธเธงเธฒเธกเน€เธเนเธฒเธเธฑเธเนเธ”เนเธเธญเธเธญเธฐเนเธซเธฅเน เนเธฅเธฐเธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”เธฅเนเธฒเธชเธธเธ”เธญเธตเธเธเธฃเธฑเนเธ
                  </p>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="inline-flex rounded-2xl bg-[#10213d]/8 p-3 text-[#10213d]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 font-kanit text-2xl font-semibold text-[#10213d]">
                    เธเนเธญเธกเธนเธฅเธญเนเธฒเธเธญเธดเธ
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    เนเธเนเธฃเธซเธฑเธชเธชเธดเธเธเนเธฒ เธเธทเนเธญเธชเธดเธเธเนเธฒ เธฃเธธเนเธเธฃเธ– เธซเธฃเธทเธญเธฃเธนเธเธญเธฐเนเธซเธฅเนเน€เธ”เธดเธกเธชเนเธเนเธซเนเธฃเนเธฒเธเนเธ”เน เน€เธเธทเนเธญเธเนเธงเธขเนเธซเนเธฃเนเธฒเธเธ•เธฃเธงเธเธชเธญเธเนเธฅเธฐเธ•เธญเธเธเธฅเธฑเธเนเธ”เนเน€เธฃเนเธงเธเธถเนเธ
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">เธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”เธชเธดเธเธเนเธฒ</h2>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    เธซเธกเธงเธ”เธชเธดเธเธเนเธฒ
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-700">{product.category.name}</dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    เธซเธเนเธงเธขเนเธชเธ”เธเธเธฅ
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-700">
                    {product.reportUnitName}
                  </dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    เธชเธ–เธฒเธเธฐเธชเธดเธเธเนเธฒ
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-700">
                    {product.stock > 0 ? "เธกเธตเธชเธดเธเธเนเธฒเนเธเธฃเธฐเธเธ" : "เธเธฃเธธเธ“เธฒเธขเธทเธเธขเธฑเธเธเธฑเธเธฃเนเธฒเธ"}
                  </dd>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    เธฃเธซเธฑเธชเธญเนเธฒเธเธญเธดเธ
                  </dt>
                  <dd className="mt-1 break-all text-sm font-medium text-slate-700">
                    {product.code}
                  </dd>
                </div>
              </dl>

              {product.aliases.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-kanit text-xl font-semibold text-[#10213d]">เธเธณเธเนเธเธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธ</h3>
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
                เธฃเธธเนเธเธฃเธ–เธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธ
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
                  เธซเธฒเธเธขเธฑเธเนเธกเนเนเธเนเนเธเธงเนเธฒเธชเธดเธเธเนเธฒเธเธตเนเธ•เธฃเธเธเธฑเธเธฃเธ–เธฃเธธเนเธเนเธ” เธชเธฒเธกเธฒเธฃเธ–เธชเนเธเธฃเธธเนเธเธฃเธ–เธซเธฃเธทเธญเธฃเธนเธเธญเธฐเนเธซเธฅเนเน€เธ”เธดเธกเนเธซเนเธฃเนเธฒเธเธเนเธงเธขเธ•เธฃเธงเธเธชเธญเธเนเธ”เน
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
              เธเธ—เธเธงเธฒเธกเธ—เธตเนเธเนเธงเธขเน€เธเนเธเธเธงเธฒเธกเน€เธเนเธฒเธเธฑเธเนเธ”เนเธเนเธญเธเธชเธฑเนเธ
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
              เธ–เนเธฒเธขเธฑเธเนเธกเนเธกเธฑเนเธเนเธเน€เธฃเธทเนเธญเธเธฃเธซเธฑเธชเน€เธ”เธดเธก OEM เธฃเธธเนเธเธฃเธ– เธซเธฃเธทเธญเธงเธดเธเธตเธ–ನೆเธฒเธขเธฃเธนเธเธเธดเนเธเธเธฒเธเน€เธ”เธดเธก เธชเธฒเธกเธฒเธฃเธ–เธญเนเธฒเธเธเธนเนเธกเธทเธญเน€เธซเธฅเนเธฒเธเธตเนเธเนเธญเธเนเธฅเนเธงเธเนเธญเธขเธชเนเธเธเนเธญเธกเธนเธฅเนเธซเนเธฃเนเธฒเธเธขเธทเธเธขเธฑเธเธ•เนเธญเนเธ”เน
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
          { name: "เธซเธเนเธฒเนเธฃเธ", item: absoluteUrl("/") },
          { name: "เธชเธดเธเธเนเธฒเธ—เธฑเนเธเธซเธกเธ”", item: absoluteUrl("/products") },
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
