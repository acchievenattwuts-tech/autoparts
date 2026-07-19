export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  buildAdminProductFilterSearchParams,
  parseAdminProductFilterParams,
  type AdminProductFilterParams,
} from "@/lib/admin-product-filter-params";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import NavLink from "@/components/shared/NavLink";
import { Plus, Pencil, Eye, X, FileText, FileSpreadsheet } from "lucide-react";
import ToggleProductButton from "./DeleteProductButton";
import ProductImagePreview from "./ProductImagePreview";
import Pagination from "@/components/shared/Pagination";
import { searchProductIds, sortProductsByIds, suggestDidYouMean } from "@/lib/product-search";
import ProductFilterForm from "./ProductFilterForm";
import { INVENTORY_TRACKING_NON_TRACKED } from "@/lib/inventory-tracking";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import AdminTableSection from "@/components/shared/AdminTableSection";
import ProductMatchChips from "@/components/shared/ProductMatchChips";
import { buildAdminProductFitmentSummary } from "@/lib/admin-product-fitment";
import ProductFitmentSummary from "./ProductFitmentSummary";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";

const PAGE_SIZE = 30;

const numberOrNull = (value?: string): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

interface ProductsPageProps {
  searchParams: Promise<{
    search?: string;
    page?: string;
    categoryId?: string;
    brandId?: string;
    carBrandId?: string;
    carModelId?: string;
    yearMin?: string;
    yearMax?: string;
    stockStatus?: string;
    statusFilter?: string;
    trackingFilter?: string;
  }>;
}

function buildRemoveParamUrl(
  params: Record<string, string | undefined>,
  removeKeys: string[],
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && !removeKeys.includes(k)) p.set(k, v);
  }
  const qs = p.toString();
  return `/admin/products${qs ? `?${qs}` : ""}`;
}

const ProductsPage = async ({ searchParams }: ProductsPageProps) => {
  const session = await auth();
  if (!session?.user) {
    redirect("/admin/login");
  }

  await requirePermission("products.view");

  const role = session.user.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session.user.permissions ?? []);

  const canCreate = hasPermissionAccess(role, permissions, "products.create");
  const canUpdate = hasPermissionAccess(role, permissions, "products.update");
  const canCancel = hasPermissionAccess(role, permissions, "products.cancel");

  const rawParams = await searchParams;
  const { page } = rawParams;
  const {
    search,
    categoryId,
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
    categoryId,
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
    path: "/admin/products",
  });

  const rawProducts = sortProductsByIds(
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
        retailPrice: true,
        memberPrice: true,
        stock: true,
        minStock: true,
        reportUnitName: true,
        warrantyDays: true,
        isActive: true,
        isStorefrontVisible: true,
        inventoryTracking: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        carModels: {
          where: { fitmentType: "DIRECT" },
          select: {
            yearStart: true,
            yearEnd: true,
            carModel: {
              select: {
                name: true,
                carBrand: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: [{ carModelId: "asc" }, { yearStart: "asc" }, { yearEnd: "asc" }],
        },
      },
    }),
    searchResult.ids,
  );

  const products = rawProducts;

  const total = searchResult.total;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const filters: AdminProductFilterParams = {
    search,
    categoryId,
    brandId,
    carBrandId,
    carModelId,
    yearMin,
    yearMax,
    stockStatus,
    statusFilter,
    trackingFilter,
  };
  const exportQuery = new URLSearchParams(buildAdminProductFilterSearchParams(filters)).toString();

  // Phase Q4 — "Did you mean" suggestions when admin search returns no/few hits
  const didYouMean = search && total < 3
    ? await suggestDidYouMean(search, 3)
    : [];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการสินค้า"
        description="ค้นหา กรอง และจัดการข้อมูลสินค้าในระบบสต็อก"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/products/export${exportQuery ? `?${exportQuery}` : ""}`}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <FileText size={16} />
              CSV
            </Link>
            <Link
              href={`/admin/products/export-excel${exportQuery ? `?${exportQuery}` : ""}`}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <FileSpreadsheet size={16} />
              Excel
            </Link>
            {canCreate ? (
              <Link
                href="/admin/products/new"
                className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
              >
                <Plus size={16} />
                เพิ่มสินค้า
              </Link>
            ) : null}
          </div>
        }
      />

      <ProductFilterForm
        search={search}
        categoryId={categoryId}
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
        carBrands={carBrands.map((brand) => ({
          id: brand.id,
          name: brand.name,
          models: brand.carModels,
        }))}
      />

      <AdminTableSection>
        {(() => {
          const allParams = filters;
          type Pill = { label: string; removeUrl: string };
          const pills: Pill[] = [];
          if (search) pills.push({ label: `ค้นหา: "${search}"`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["search"]) });
          if (categoryId) {
            const cat = categories.find((c) => c.id === categoryId);
            pills.push({ label: `หมวดหมู่: ${cat?.name ?? categoryId}`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["categoryId"]) });
          }
          if (brandId) {
            const br = partsBrands.find((b) => b.id === brandId);
            pills.push({ label: `แบรนด์: ${br?.name ?? brandId}`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["brandId"]) });
          }
          if (carBrandId) {
            const cb = carBrands.find((b) => b.id === carBrandId);
            pills.push({ label: `ยี่ห้อรถ: ${cb?.name ?? carBrandId}`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["carBrandId", "carModelId"]) });
          }
          if (carModelId) {
            const cm = carBrands.flatMap((b) => b.carModels).find((m) => m.id === carModelId);
            pills.push({ label: `รุ่นรถ: ${cm?.name ?? carModelId}`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["carModelId"]) });
          }
          if (yearMin || yearMax) {
            const label = yearMin && yearMax
              ? `ปีรถ: ${Number(yearMin).toLocaleString("th-TH-u-ca-gregory")}–${Number(yearMax).toLocaleString("th-TH-u-ca-gregory")}`
              : yearMin ? `ปีรถ ≥ ${Number(yearMin).toLocaleString("th-TH-u-ca-gregory")}` : `ปีรถ ≤ ${Number(yearMax).toLocaleString("th-TH-u-ca-gregory")}`;
            pills.push({ label, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["yearMin", "yearMax"]) });
          }
          if (stockStatus) {
            const map: Record<string, string> = { in_stock: "มีสต็อก", low_stock: "สต็อกต่ำ", out_of_stock: "หมดสต็อก" };
            pills.push({ label: `สต็อก: ${map[stockStatus] ?? stockStatus}`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["stockStatus"]) });
          }
          if (statusFilter) {
            pills.push({ label: `สถานะ: ${statusFilter === "active" ? "ใช้งาน" : "ปิดใช้งาน"}`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["statusFilter"]) });
          }
          if (trackingFilter) {
            pills.push({ label: `การคำนวณ: ${trackingFilter === "tracked" ? "คำนวณสต็อก" : "ไม่คำนวณ"}`, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["trackingFilter"]) });
          }
          if (pills.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1.5 border-b border-gray-100 px-6 py-3 dark:border-white/10">
              {pills.map((pill) => (
                <NavLink
                  key={pill.label}
                  href={pill.removeUrl}
                  hideSpinner
                  ariaLabel={`ลบฟิลเตอร์ ${pill.label}`}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-red-400/30 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  pendingChildren={
                    <>
                      {pill.label}
                      <span className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    </>
                  }
                >
                  {pill.label}
                  <X size={10} />
                </NavLink>
              ))}
            </div>
          );
        })()}
        <div className="border-b border-gray-100 px-6 py-4 dark:border-white/10">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {search ? (
              <>
                ผลการค้นหา &quot;{search}&quot;:{" "}
                <span className="font-medium text-gray-700 dark:text-slate-200">{total} รายการ</span>
              </>
            ) : (
              <>
                สินค้าทั้งหมด:{" "}
                <span className="font-medium text-gray-700 dark:text-slate-200">{total} รายการ</span>
              </>
            )}
          </p>
        </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รูป</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อสินค้า</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ยี่ห้อรถ</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">หมวดหมู่</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">การคำนวณ</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">หน้าบ้าน</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ตำแหน่ง Shelf</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">
                  ราคาขาย
                  <span className="block text-xs font-normal text-gray-400 dark:text-slate-500">ส่ง / ปลีก</span>
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">Stock</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">ประกัน</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-gray-400 dark:text-slate-500">
                    <p>{search ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้า"}</p>
                    {didYouMean.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">คุณหมายถึง:</p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {didYouMean.map((suggestion) => (
                            <NavLink
                              key={suggestion}
                              href={`/admin/products?search=${encodeURIComponent(suggestion)}`}
                              className="inline-flex items-center rounded-full border border-[#1e3a5f]/20 bg-[#1e3a5f]/5 px-3 py-1 text-xs font-medium text-[#1e3a5f] transition hover:border-[#1e3a5f] hover:bg-[#1e3a5f]/10 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:border-sky-400 dark:hover:bg-sky-500/20"
                              hideSpinner
                            >
                              {suggestion}
                            </NavLink>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const fitmentSummary = buildAdminProductFitmentSummary(product.carModels);

                  return (
                    <tr
                      key={product.id}
                      className={`border-t border-gray-50 transition-colors dark:border-white/10 ${
                        getAdminMasterRowClass(product.isActive)
                      }`}
                    >
                      <td className="px-4 py-3">
                        {(product.imageUrl || product.images.length > 0) ? (
                          <ProductImagePreview
                            imageUrl={product.imageUrl}
                            images={product.images}
                            alt={product.name}
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-white/5">
                            <span className="text-xs text-gray-300">ไม่มี</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-gray-700 dark:text-slate-200">
                        {product.code}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-slate-100">
                        <p className="font-medium">{product.name}</p>
                        {product.brand && (
                          <p className="text-xs text-gray-400 dark:text-slate-500">{product.brand.name}</p>
                        )}
                        {search && searchResult.matchReasons?.[product.id]?.length ? (
                          <div className="mt-1">
                            <ProductMatchChips
                              reasons={searchResult.matchReasons[product.id]}
                              compact
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600 dark:text-slate-300">
                        <ProductFitmentSummary
                          lines={fitmentSummary.lines}
                          hiddenCount={fitmentSummary.hiddenCount}
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{product.category.name}</td>
                      <td className="px-4 py-3 text-center">
                        {product.inventoryTracking === INVENTORY_TRACKING_NON_TRACKED ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                            ไม่คำนวณสต็อก
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
                            คำนวณสต็อก
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <AdminStatusBadge tone={product.isStorefrontVisible ? "success" : "neutral"}>
                          {product.isStorefrontVisible ? "แสดง" : "ซ่อน"}
                        </AdminStatusBadge>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                        {product.shelfLocation ?? <span className="text-gray-300 dark:text-slate-500">-</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="text-[10px] font-semibold uppercase text-emerald-500 dark:text-emerald-400">ส่ง</span>
                            <span className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                              {Number(product.salePrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </span>
                          </span>
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="text-[10px] font-semibold uppercase text-sky-500 dark:text-sky-400">สมาชิก</span>
                            <span className="text-sm font-semibold tabular-nums text-sky-600 dark:text-sky-300">
                              {Number(product.memberPrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </span>
                          </span>
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="text-[10px] font-medium uppercase text-gray-400 dark:text-slate-500">ปลีก</span>
                            <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-slate-400">
                              {Number(product.retailPrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`font-medium ${
                            product.stock <= product.minStock ? "text-red-600 dark:text-red-300" : "text-gray-800 dark:text-slate-100"
                          }`}
                        >
                          {product.stock}
                        </span>
                        <span className="ml-1 text-xs text-gray-400 dark:text-slate-500">
                          {product.reportUnitName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {product.warrantyDays > 0 ? (
                          <span className="inline-flex items-center rounded-full border border-sky-300 bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:border-sky-400/60 dark:bg-sky-500/25 dark:text-sky-200">
                            {product.warrantyDays} วัน
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {product.isActive ? (
                          <AdminStatusBadge tone={getAdminActiveBadgeTone(product.isActive)}>ใช้งาน</AdminStatusBadge>
                        ) : (
                          <AdminStatusBadge tone={getAdminActiveBadgeTone(product.isActive)}>ปิดใช้งาน</AdminStatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <AdminActionGroup align="end">
                          <Link
                            href={`/admin/products/${product.id}/preview`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-white/5"
                          >
                            <Eye size={12} />
                            ดู
                          </Link>
                          {canUpdate && (
                            <Link
                              href={`/admin/products/${product.id}/edit`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055]"
                            >
                              <Pencil size={12} />
                              แก้ไข
                            </Link>
                          )}
                          {canCancel && (
                            <ToggleProductButton
                              id={product.id}
                              name={product.name}
                              isActive={product.isActive}
                            />
                          )}
                        </AdminActionGroup>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
      </AdminTableSection>

      <Pagination
        currentPage={pageNum}
        totalPages={totalPages}
        basePath="/admin/products"
        searchParams={buildAdminProductFilterSearchParams(filters)}
      />
    </div>
  );
};

export default ProductsPage;
