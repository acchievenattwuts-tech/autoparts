export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Plus, Pencil, X } from "lucide-react";
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

const PAGE_SIZE = 30;

interface ProductsPageProps {
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
  await requirePermission("products.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const canCreate = hasPermissionAccess(role, permissions, "products.create");
  const canUpdate = hasPermissionAccess(role, permissions, "products.update");
  const canCancel = hasPermissionAccess(role, permissions, "products.cancel");

  const {
    search, page, categoryId, brandId, carBrandId, carModelId,
    priceMin, priceMax, stockStatus, statusFilter, trackingFilter,
  } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const searchIsActive =
    statusFilter === "active" ? true :
    statusFilter === "inactive" ? false :
    undefined;

  const productSearchInput = {
    query: search,
    categoryId,
    brandId,
    carBrandId,
    carModelId,
    isActive: searchIsActive,
    skip: (pageNum - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    order: "codeDesc" as const,
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

  const advancedWhere: Record<string, unknown> = {};
  if (priceMin || priceMax) {
    advancedWhere.salePrice = {
      ...(priceMin ? { gte: parseFloat(priceMin) } : {}),
      ...(priceMax ? { lte: parseFloat(priceMax) } : {}),
    };
  }
  if (trackingFilter === "tracked") advancedWhere.inventoryTracking = "TRACKED";
  else if (trackingFilter === "non_tracked") advancedWhere.inventoryTracking = "NON_TRACKED";

  const rawProducts = sortProductsByIds(
    await db.product.findMany({
      where: {
        id: { in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"] },
        ...advancedWhere,
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
        warrantyDays: true,
        isActive: true,
        inventoryTracking: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        carModels: {
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

  const products = stockStatus
    ? rawProducts.filter((p) => {
        const s = Number(p.stock);
        const min = Number(p.minStock);
        if (stockStatus === "in_stock") return s > min;
        if (stockStatus === "low_stock") return s > 0 && s <= min;
        if (stockStatus === "out_of_stock") return s <= 0;
        return true;
      })
    : rawProducts;

  const total = searchResult.total;
  const totalPages = Math.ceil(total / PAGE_SIZE);

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
          canCreate ? (
          <Link
            href="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <Plus size={16} />
            เพิ่มสินค้า
          </Link>
          ) : null
        }
      />

      <ProductFilterForm
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
        carBrands={carBrands.map((brand) => ({
          id: brand.id,
          name: brand.name,
          models: brand.carModels,
        }))}
      />

      <AdminTableSection>
        {(() => {
          const allParams = { search, categoryId, brandId, carBrandId, carModelId, priceMin, priceMax, stockStatus, statusFilter, trackingFilter };
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
          if (priceMin || priceMax) {
            const label = priceMin && priceMax
              ? `ราคา: ${Number(priceMin).toLocaleString("th-TH-u-ca-gregory")}–${Number(priceMax).toLocaleString("th-TH-u-ca-gregory")} ฿`
              : priceMin ? `ราคา ≥ ${Number(priceMin).toLocaleString("th-TH-u-ca-gregory")} ฿` : `ราคา ≤ ${Number(priceMax).toLocaleString("th-TH-u-ca-gregory")} ฿`;
            pills.push({ label, removeUrl: buildRemoveParamUrl({ ...allParams, page: undefined }, ["priceMin", "priceMax"]) });
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
                <Link
                  key={pill.label}
                  href={pill.removeUrl}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-red-400/30 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  {pill.label}
                  <X size={10} />
                </Link>
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
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ตำแหน่ง Shelf</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ราคาขาย</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">Stock</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">ประกัน</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-gray-400 dark:text-slate-500">
                    <p>{search ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้า"}</p>
                    {didYouMean.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">คุณหมายถึง:</p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {didYouMean.map((suggestion) => (
                            <Link
                              key={suggestion}
                              href={`/admin/products?search=${encodeURIComponent(suggestion)}`}
                              className="inline-flex items-center rounded-full border border-[#1e3a5f]/20 bg-[#1e3a5f]/5 px-3 py-1 text-xs font-medium text-[#1e3a5f] transition hover:border-[#1e3a5f] hover:bg-[#1e3a5f]/10 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:border-sky-400 dark:hover:bg-sky-500/20"
                            >
                              {suggestion}
                            </Link>
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
                        product.isActive ? "hover:bg-gray-50 dark:hover:bg-white/5" : "bg-gray-50 opacity-60 dark:bg-white/5"
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
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                        {product.shelfLocation ?? <span className="text-gray-300 dark:text-slate-500">-</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-slate-100">
                        {Number(product.salePrice).toLocaleString("th-TH", {
                          minimumFractionDigits: 2,
                        })}
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
                          <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
                        ) : (
                          <AdminStatusBadge tone="muted">ปิดใช้งาน</AdminStatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <AdminActionGroup align="end">
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
        searchParams={{
          ...(search ? { search } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(brandId ? { brandId } : {}),
          ...(carBrandId ? { carBrandId } : {}),
          ...(carModelId ? { carModelId } : {}),
        }}
      />
    </div>
  );
};

export default ProductsPage;
