export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, Box, ChevronRight, MapPin, ShieldCheck, Sparkles } from "lucide-react";

import Pagination from "@/components/shared/Pagination";
import ProductMatchChips from "@/components/shared/ProductMatchChips";
import ProductFitmentSummary from "@/app/admin/(protected)/products/ProductFitmentSummary";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import { buildAdminProductFitmentSummary } from "@/lib/admin-product-fitment";
import { INVENTORY_TRACKING_NON_TRACKED } from "@/lib/inventory-tracking";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import { searchProductIds, sortProductsByIds, suggestDidYouMean } from "@/lib/product-search";

import MobileProductSearchForm from "./MobileProductSearchForm";

const PAGE_SIZE = 20;

type ProductsSearchPageProps = {
  searchParams: Promise<{
    search?: string;
    page?: string;
    categoryId?: string;
    brandId?: string;
    carBrandId?: string;
    carModelId?: string;
    priceMin?: string;
    priceMax?: string;
    stockStatus?: string;
    statusFilter?: string;
    trackingFilter?: string;
  }>;
};

const numberOrNull = (value?: string): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const stockStatusLabel: Record<string, string> = {
  in_stock: "มีของ",
  low_stock: "ใกล้หมด",
  out_of_stock: "หมด",
};

const buildProductSearchUrl = (params: Record<string, string>) => {
  const qs = new URLSearchParams(params).toString();
  return `/admin/products/search${qs ? `?${qs}` : ""}`;
};

const ProductsMobileSearchPage = async ({ searchParams }: ProductsSearchPageProps) => {
  await requirePermission("products.view");

  const {
    search,
    page,
    categoryId,
    brandId,
    carBrandId,
    carModelId,
    priceMin,
    priceMax,
    stockStatus,
    statusFilter,
    trackingFilter,
  } = await searchParams;

  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const searchIsActive =
    statusFilter === "active" ? true :
    statusFilter === "inactive" ? false :
    undefined;
  const normalizedStockStatus: "in_stock" | "low_stock" | "out_of_stock" | undefined =
    stockStatus === "in_stock" || stockStatus === "low_stock" || stockStatus === "out_of_stock"
      ? stockStatus
      : undefined;
  const inventoryTracking: "TRACKED" | "NON_TRACKED" | undefined =
    trackingFilter === "tracked"
      ? "TRACKED"
      : trackingFilter === "non_tracked"
        ? "NON_TRACKED"
        : undefined;

  const productSearchInput = {
    query: search,
    categoryId,
    brandId,
    carBrandId,
    carModelId,
    isActive: searchIsActive,
    priceMin: numberOrNull(priceMin),
    priceMax: numberOrNull(priceMax),
    stockStatus: normalizedStockStatus,
    inventoryTracking,
    skip: (pageNum - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    order: "codeDesc" as const,
    cacheProfile: "admin" as const,
  };

  const [searchResult, categories, partsBrands, carBrands] = await Promise.all([
    searchProductIds(productSearchInput),
    db.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.partsBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        carModels: {
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
  ]);

  await logProductSearchTelemetry({
    input: productSearchInput,
    resultCount: searchResult.total,
    source: "admin",
    path: "/admin/products/search",
  });

  const products = sortProductsByIds(
    await db.product.findMany({
      where: {
        id: { in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"] },
      },
      select: {
        id: true,
        imageUrl: true,
        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { url: true, alt: true },
        },
        code: true,
        name: true,
        shelfLocation: true,
        salePrice: true,
        stock: true,
        minStock: true,
        reportUnitName: true,
        saleUnitName: true,
        warrantyDays: true,
        isActive: true,
        inventoryTracking: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        aliases: { take: 4, select: { alias: true } },
        carModels: {
          where: { fitmentType: "DIRECT" },
          select: {
            yearStart: true,
            yearEnd: true,
            carModel: {
              select: {
                name: true,
                carBrand: { select: { name: true } },
              },
            },
          },
          orderBy: [{ carModelId: "asc" }, { yearStart: "asc" }, { yearEnd: "asc" }],
        },
      },
    }),
    searchResult.ids,
  );

  const total = searchResult.total;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const didYouMean = search && total < 3 ? await suggestDidYouMean(search, 3) : [];
  const hasFilters = Boolean(
    search || categoryId || brandId || carBrandId || carModelId || priceMin || priceMax || stockStatus || statusFilter || trackingFilter,
  );

  const paginationParams = {
    ...(search ? { search } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(brandId ? { brandId } : {}),
    ...(carBrandId ? { carBrandId } : {}),
    ...(carModelId ? { carModelId } : {}),
    ...(priceMin ? { priceMin } : {}),
    ...(priceMax ? { priceMax } : {}),
    ...(stockStatus ? { stockStatus } : {}),
    ...(statusFilter ? { statusFilter } : {}),
    ...(trackingFilter ? { trackingFilter } : {}),
  };
  const currentSearchHref = buildProductSearchUrl({
    ...paginationParams,
    ...(pageNum > 1 ? { page: String(pageNum) } : {}),
  });

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-50 via-white to-slate-50 text-gray-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-8 sm:px-6 lg:py-4">
        <MobileProductSearchForm
          search={search}
          categoryId={categoryId}
          brandId={brandId}
          carBrandId={carBrandId}
          carModelId={carModelId}
          priceMin={priceMin}
          priceMax={priceMax}
          stockStatus={stockStatus}
          statusFilter={statusFilter}
          trackingFilter={trackingFilter}
          categories={categories}
          partsBrands={partsBrands}
          carBrands={carBrands.map((brand) => ({ id: brand.id, name: brand.name, models: brand.carModels }))}
          resultCount={total}
          currentSearchHref={currentSearchHref}
        />

        {hasFilters ? (
          <ActiveFilterSummary
            search={search}
            stockStatus={stockStatus}
            categoryName={categories.find((category) => category.id === categoryId)?.name}
            brandName={partsBrands.find((brand) => brand.id === brandId)?.name}
            carBrandName={carBrands.find((brand) => brand.id === carBrandId)?.name}
            carModelName={carBrands.flatMap((brand) => brand.carModels).find((model) => model.id === carModelId)?.name}
          />
        ) : null}

        {products.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {products.map((product) => {
              const fitmentSummary = buildAdminProductFitmentSummary(product.carModels);
              const stockNum = Number(product.stock);
              const minStockNum = Number(product.minStock);
              const stockTone =
                stockNum <= 0 ? "out" :
                stockNum <= minStockNum ? "low" :
                "ok";
              const primaryImage = product.imageUrl || product.images[0]?.url || null;
              const displayUnit = product.saleUnitName || product.reportUnitName;

              return (
                <article
                  key={product.id}
                  className="group rounded-[24px] border border-gray-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md dark:border-white/10 dark:bg-slate-900 dark:hover:border-orange-400/40"
                >
                  <div className="flex gap-3">
                    <Link
                      href={`/admin/products/${product.id}/preview?returnTo=${encodeURIComponent(currentSearchHref)}`}
                      className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-gray-100 outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-orange-500 dark:bg-slate-800 sm:h-32 sm:w-32"
                      aria-label={`ดูข้อมูลสินค้า ${product.name}`}
                    >
                        {primaryImage ? (
                          <Image
                            src={primaryImage}
                            alt={product.name}
                            fill
                            className="object-cover transition duration-300 group-hover:scale-105"
                            sizes="128px"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-slate-600">
                            <Box size={34} />
                          </div>
                        )}
                        {!product.isActive ? (
                          <span className="absolute left-2 top-2 rounded-full bg-gray-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
                            ปิดใช้งาน
                          </span>
                        ) : null}
                    </Link>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <Link
                          href={`/admin/products/${product.id}/preview?returnTo=${encodeURIComponent(currentSearchHref)}`}
                          className="min-w-0 outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-orange-500"
                        >
                          <p className="font-mono text-xs font-semibold text-gray-500 dark:text-slate-400">{product.code}</p>
                          <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-gray-900 transition group-hover:text-[#1e3a5f] dark:text-slate-50 dark:group-hover:text-sky-200">
                            {product.name}
                          </h2>
                        </Link>
                        <Link
                          href={`/admin/products/${product.id}/preview?returnTo=${encodeURIComponent(currentSearchHref)}`}
                          className="mt-2 shrink-0 rounded-full p-1 text-gray-300 transition hover:bg-orange-50 hover:text-orange-500 dark:hover:bg-orange-500/10"
                          aria-label={`เปิด preview ${product.name}`}
                        >
                          <ChevronRight size={18} className="transition group-hover:translate-x-0.5" />
                        </Link>
                      </div>

                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <TinyBadge>{product.category.name}</TinyBadge>
                        {product.brand ? <TinyBadge>{product.brand.name}</TinyBadge> : null}
                        {product.inventoryTracking === INVENTORY_TRACKING_NON_TRACKED ? (
                          <TinyBadge tone="amber">ไม่คำนวณสต็อก</TinyBadge>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-50 p-2 dark:bg-white/5">
                        <div>
                          <p className="text-[11px] text-gray-400 dark:text-slate-500">ราคาขาย</p>
                          <p className="text-base font-bold text-[#f97316]">
                            ฿{Number(product.salePrice).toLocaleString("th-TH-u-ca-gregory")}
                          </p>
                          <p className="text-[10px] text-gray-400">/{displayUnit}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-gray-400 dark:text-slate-500">คงเหลือ</p>
                          <p
                            className={`text-base font-bold ${
                              stockTone === "out"
                                ? "text-red-600 dark:text-red-300"
                                : stockTone === "low"
                                ? "text-amber-600 dark:text-amber-300"
                                : "text-emerald-600 dark:text-emerald-300"
                            }`}
                          >
                            {stockNum.toLocaleString("en-US")} <span className="text-xs font-medium">{product.reportUnitName}</span>
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {stockTone === "out" ? "หมดสต็อก" : stockTone === "low" ? "ใกล้ขั้นต่ำ" : "พร้อมขาย"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-2 space-y-2 text-xs text-gray-500 dark:text-slate-400">
                        <div className="flex items-center gap-1.5 rounded-xl bg-sky-50 px-2.5 py-1.5 font-semibold text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
                          <MapPin size={13} />
                          <span>Shelf</span>
                          <span className="font-mono">{product.shelfLocation?.trim() || "-"}</span>
                        </div>
                        {product.warrantyDays > 0 ? (
                          <p className="flex items-center gap-1.5">
                            <ShieldCheck size={12} className="text-emerald-600 dark:text-emerald-300" />
                            ประกัน {product.warrantyDays} วัน
                          </p>
                        ) : null}
                        <ProductFitmentSummary
                          lines={fitmentSummary.lines}
                          hiddenCount={fitmentSummary.hiddenCount}
                        />
                      </div>

                      {product.aliases.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {product.aliases.map((alias, index) => (
                            <span key={`${product.id}-${alias.alias}-${index}`} className="rounded-full bg-sky-50 px-2 py-0.5 font-mono text-[10px] text-sky-700 dark:bg-sky-500/10 dark:text-sky-200">
                              {alias.alias}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {search && searchResult.matchReasons?.[product.id]?.length ? (
                        <div className="mt-2">
                          <ProductMatchChips reasons={searchResult.matchReasons[product.id]} compact />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-200">
              <AlertTriangle size={24} />
            </div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ไม่พบสินค้าที่ตรงเงื่อนไข</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500 dark:text-slate-400">
              ลองลดตัวกรอง หรือค้นด้วยรหัสสินค้า ชื่อเรียกอื่น รหัส OEM หรือรุ่นรถ
            </p>
            {didYouMean.length > 0 ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {didYouMean.map((suggestion) => (
                  <Link
                    key={suggestion}
                    href={`/admin/products/search?search=${encodeURIComponent(suggestion)}`}
                    className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-200"
                  >
                    <Sparkles size={12} />
                    {suggestion}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <Pagination
          currentPage={pageNum}
          totalPages={totalPages}
          basePath="/admin/products/search"
          searchParams={paginationParams}
        />
      </div>
    </div>
  );
};

function TinyBadge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "amber" }) {
  return (
    <span
      className={
        tone === "amber"
          ? "rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200"
          : "rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-white/10 dark:text-slate-300"
      }
    >
      {children}
    </span>
  );
}

function ActiveFilterSummary({
  search,
  stockStatus,
  categoryName,
  brandName,
  carBrandName,
  carModelName,
}: {
  search?: string;
  stockStatus?: string;
  categoryName?: string;
  brandName?: string;
  carBrandName?: string;
  carModelName?: string;
}) {
  const chips = [
    search ? `ค้นหา: ${search}` : null,
    categoryName ? `หมวด: ${categoryName}` : null,
    brandName ? `แบรนด์: ${brandName}` : null,
    carBrandName ? `รถ: ${carBrandName}` : null,
    carModelName ? `รุ่น: ${carModelName}` : null,
    stockStatus ? `สต็อก: ${stockStatusLabel[stockStatus] ?? stockStatus}` : null,
  ].filter(Boolean);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <span key={chip} className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">
          {chip}
        </span>
      ))}
    </div>
  );
}

export default ProductsMobileSearchPage;
