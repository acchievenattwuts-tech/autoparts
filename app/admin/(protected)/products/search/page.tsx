export const dynamic = "force-dynamic";

import Link from "next/link";
import { AlertTriangle, ChevronRight, MapPin, Pencil, ShieldCheck, Sparkles } from "lucide-react";

import Pagination from "@/components/shared/Pagination";
import ProductMatchChips from "@/components/shared/ProductMatchChips";
import ProductFitmentSummary from "@/app/admin/(protected)/products/ProductFitmentSummary";
import {
  buildAdminProductFilterQueryString,
  buildAdminProductFilterSearchParams,
  parseAdminProductFilterParams,
  type AdminProductFilterParams,
} from "@/lib/admin-product-filter-params";
import type { Prisma } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import { buildAdminProductFitmentSummary } from "@/lib/admin-product-fitment";
import { INVENTORY_TRACKING_NON_TRACKED } from "@/lib/inventory-tracking";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import { searchProductIds, sortProductsByIds, suggestDidYouMean } from "@/lib/product-search";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";

import MobileProductSearchForm from "./MobileProductSearchForm";
import ProductCardImage from "./ProductCardImage";

const PAGE_SIZE = 20;

type ProductsSearchPageProps = {
  searchParams: Promise<{
    search?: string;
    page?: string;
    /** ซ้ำได้ — เลือกหลายหมวดพร้อมกัน */
    categoryId?: string | string[];
    brandId?: string;
    carBrandId?: string;
    carModelId?: string;
    yearMin?: string;
    yearMax?: string;
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

const formatPriceLevel = (value: Prisma.Decimal): string =>
  Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2 });

const stockStatusLabel: Record<string, string> = {
  in_stock: "มีของ",
  low_stock: "ใกล้หมด",
  out_of_stock: "หมด",
};

const buildProductSearchUrl = (params: AdminProductFilterParams & { page?: string }) => {
  const qs = buildAdminProductFilterQueryString(params);
  return `/admin/products/search${qs ? `?${qs}` : ""}`;
};

const ProductsMobileSearchPage = async ({ searchParams }: ProductsSearchPageProps) => {
  await requirePermission("products.view");

  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "products.update");

  const rawParams = await searchParams;
  const { page } = rawParams;
  const {
    search,
    categoryIds,
    brandId,
    carBrandId,
    carModelId,
    yearMin,
    yearMax,
    stockStatus,
    statusFilter,
    trackingFilter,
  } = parseAdminProductFilterParams(rawParams);

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
  const requiredTokens = extractProductSearchRequiredTokens(search);

  const productSearchInput = {
    query: search,
    categoryIds,
    brandId,
    carBrandId,
    carModelId,
    isActive: searchIsActive,
    yearMin: numberOrNull(yearMin),
    yearMax: numberOrNull(yearMax),
    stockStatus: normalizedStockStatus,
    inventoryTracking,
    skip: (pageNum - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    order: "codeDesc" as const,
    cacheProfile: "admin" as const,
    ...(requiredTokens.length > 0 ? { requiredTokens } : {}),
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
        memberPrice: true,
        retailPrice: true,
        stock: true,
        minStock: true,
        reportUnitName: true,
        saleUnitName: true,
        warrantyDays: true,
        isActive: true,
        isStorefrontVisible: true,
        inventoryTracking: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        aliases: { orderBy: { id: "asc" }, take: 4, select: { alias: true } },
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
    search || (categoryIds?.length ?? 0) > 0 || brandId || carBrandId || carModelId || yearMin || yearMax || stockStatus || statusFilter || trackingFilter,
  );

  const paginationParams: AdminProductFilterParams = {
    search,
    categoryIds,
    brandId,
    carBrandId,
    carModelId,
    yearMin,
    yearMax,
    stockStatus,
    statusFilter,
    trackingFilter,
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
          categoryIds={categoryIds}
          brandId={brandId}
          carBrandId={carBrandId}
          carModelId={carModelId}
          yearMin={yearMin}
          yearMax={yearMax}
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
            categoryNames={(categoryIds ?? []).map(
              (id) => categories.find((category) => category.id === id)?.name ?? id,
            )}
            brandName={partsBrands.find((brand) => brand.id === brandId)?.name}
            carBrandName={carBrands.find((brand) => brand.id === carBrandId)?.name}
            carModelName={carBrands.flatMap((brand) => brand.carModels).find((model) => model.id === carModelId)?.name}
            yearMin={yearMin}
            yearMax={yearMax}
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
              const displayUnit = product.saleUnitName || product.reportUnitName;

              return (
                <article
                  key={product.id}
                  className="group rounded-[24px] border border-gray-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md dark:border-white/10 dark:bg-slate-900 dark:hover:border-orange-400/40"
                >
                  <div className="flex gap-3">
                    <div className="flex w-28 shrink-0 flex-col gap-2 sm:w-32">
                      <ProductCardImage
                        imageUrl={product.imageUrl}
                        images={product.images}
                        name={product.name}
                        isActive={product.isActive}
                      />
                      {canUpdate ? (
                        <Link
                          href={`/admin/products/${product.id}/edit?returnTo=${encodeURIComponent(currentSearchHref)}`}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055]"
                        >
                          <Pencil size={12} />
                          แก้ไข
                        </Link>
                      ) : null}
                    </div>

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
                        <TinyBadge tone={product.isStorefrontVisible ? "green" : "slate"}>
                          {product.isStorefrontVisible ? "แสดงหน้าบ้าน" : "ซ่อนหน้าบ้าน"}
                        </TinyBadge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-50 p-2 dark:bg-white/5">
                        <div>
                          <p className="text-[11px] text-gray-400 dark:text-slate-500">ราคาขาย</p>
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="text-[10px] font-semibold uppercase text-emerald-500 dark:text-emerald-400">ส่ง</span>
                              <span className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                                {formatPriceLevel(product.salePrice)}
                              </span>
                            </span>
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="text-[10px] font-semibold uppercase text-sky-500 dark:text-sky-400">สมาชิก</span>
                              <span className="text-sm font-semibold tabular-nums text-sky-600 dark:text-sky-300">
                                {formatPriceLevel(product.memberPrice)}
                              </span>
                            </span>
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="text-[10px] font-medium uppercase text-gray-400 dark:text-slate-500">ปลีก</span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-slate-400">
                                {formatPriceLevel(product.retailPrice)}
                              </span>
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-gray-400">/{displayUnit}</p>
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
          searchParams={buildAdminProductFilterSearchParams(paginationParams)}
        />
      </div>
    </div>
  );
};

function TinyBadge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "amber" | "green" | "slate";
}) {
  const toneClass =
    tone === "amber"
      ? "rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200"
      : tone === "green"
        ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
        : tone === "slate"
          ? "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700/60 dark:text-slate-200"
          : "rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-white/10 dark:text-slate-300";

  return (
    <span className={toneClass}>
      {children}
    </span>
  );
}

function ActiveFilterSummary({
  search,
  stockStatus,
  categoryNames,
  brandName,
  carBrandName,
  carModelName,
  yearMin,
  yearMax,
}: {
  search?: string;
  stockStatus?: string;
  categoryNames?: string[];
  brandName?: string;
  carBrandName?: string;
  carModelName?: string;
  yearMin?: string;
  yearMax?: string;
}) {
  // A half-filled range is mirrored at parse time, so both ends arrive set. Show
  // BOTH ("2010-2010") so the range actually being searched is visible.
  const yearLabel =
    yearMin && yearMax
      ? `ปีรถ: ${yearMin}-${yearMax}`
      : yearMin
        ? `ปีรถ: ${yearMin}-${yearMin}`
        : yearMax
          ? `ปีรถ: ${yearMax}-${yearMax}`
          : null;
  const chips = [
    search ? `ค้นหา: ${search}` : null,
    ...(categoryNames ?? []).map((name) => `หมวด: ${name}`),
    brandName ? `แบรนด์: ${brandName}` : null,
    carBrandName ? `รถ: ${carBrandName}` : null,
    carModelName ? `รุ่น: ${carModelName}` : null,
    yearLabel,
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
