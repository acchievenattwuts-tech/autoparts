export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
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

const PAGE_SIZE = 30;

interface ProductsPageProps {
  searchParams: Promise<{
    search?: string;
    page?: string;
    categoryId?: string;
    brandId?: string;
    carBrandId?: string;
    carModelId?: string;
  }>;
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

  const { search, page, categoryId, brandId, carBrandId, carModelId } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const productSearchInput = {
    query: search,
    categoryId,
    brandId,
    carBrandId,
    carModelId,
    skip: (pageNum - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    order: "codeDesc",
  } as const;

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

  const products = sortProductsByIds(
    await db.product.findMany({
      where: {
        id: { in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"] },
      },
      select: {
        id: true,
        imageUrl: true,
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

  const total = searchResult.total;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const didYouMean = search && total < 3
    ? await suggestDidYouMean(search, 3)
    : [];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="เธเธฑเธ”เธเธฒเธฃเธชเธดเธเธเนเธฒ"
        description="เธเนเธเธซเธฒ เธเธฃเธญเธ เนเธฅเธฐเธเธฑเธ”เธเธฒเธฃเธเนเธญเธกเธนเธฅเธชเธดเธเธเนเธฒเนเธเธฃเธฐเธเธเธชเธ•เนเธญเธ"
        actions={
          canCreate ? (
            <Link
              href="/admin/products/new"
              className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <Plus size={16} />
              เน€เธเธดเนเธกเธชเธดเธเธเนเธฒ
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
        categories={categories}
        partsBrands={partsBrands}
        carBrands={carBrands.map((brand) => ({
          id: brand.id,
          name: brand.name,
          models: brand.carModels,
        }))}
      />

      <AdminTableSection>
        <div className="border-b border-gray-100 px-6 py-4 dark:border-white/10">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {search ? (
              <>
                เธเธฅเธเธฒเธฃเธเนเธเธซเธฒ &quot;{search}&quot;:{" "}
                <span className="font-medium text-gray-700 dark:text-slate-200">{total} เธฃเธฒเธขเธเธฒเธฃ</span>
              </>
            ) : (
              <>
                เธชเธดเธเธเนเธฒเธ—เธฑเนเธเธซเธกเธ”:{" "}
                <span className="font-medium text-gray-700 dark:text-slate-200">{total} เธฃเธฒเธขเธเธฒเธฃ</span>
              </>
            )}
          </p>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เธฃเธนเธ</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เธฃเธซเธฑเธช</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เธเธทเนเธญเธชเธดเธเธเนเธฒ</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ยี่ห้อรถ</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เธซเธกเธงเธ”เธซเธกเธนเน</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">เธเธฒเธฃเธเธณเธเธงเธ“</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เธ•เธณเนเธซเธเนเธ Shelf</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">เธฃเธฒเธเธฒเธเธฒเธข</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">Stock</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">เธเธฃเธฐเธเธฑเธ</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">เธชเธ–เธฒเธเธฐ</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">เธเธฑเธ”เธเธฒเธฃ</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-12 text-center text-gray-400 dark:text-slate-500">
                  <p>{search ? "เนเธกเนเธเธเธชเธดเธเธเนเธฒเธ—เธตเนเธเนเธเธซเธฒ" : "เธขเธฑเธเนเธกเนเธกเธตเธชเธดเธเธเนเธฒ"}</p>
                  {didYouMean.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">เธเธธเธ“เธซเธกเธฒเธขเธ–เธถเธ:</p>
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
                      {product.imageUrl ? (
                        <ProductImagePreview src={product.imageUrl} alt={product.name} />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-white/5">
                          <span className="text-xs text-gray-300">เนเธกเนเธกเธต</span>
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
                      {fitmentSummary.lines.length > 0 ? (
                        <div className="max-w-64 space-y-1">
                          {fitmentSummary.lines.map((line) => (
                            <p key={line} className="line-clamp-1 text-xs leading-5 text-gray-600 dark:text-slate-300">
                              {line}
                            </p>
                          ))}
                          {fitmentSummary.hiddenCount > 0 ? (
                            <p className="text-xs font-medium text-[#1e3a5f] dark:text-sky-300">
                              +{fitmentSummary.hiddenCount} รุ่น
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{product.category.name}</td>
                    <td className="px-4 py-3 text-center">
                      {product.inventoryTracking === INVENTORY_TRACKING_NON_TRACKED ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                          เนเธกเนเธเธณเธเธงเธ“เธชเธ•เนเธญเธ
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
                          เธเธณเธเธงเธ“เธชเธ•เนเธญเธ
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
                          {product.warrantyDays} เธงเธฑเธ
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {product.isActive ? (
                        <AdminStatusBadge tone="success">เนเธเนเธเธฒเธ</AdminStatusBadge>
                      ) : (
                        <AdminStatusBadge tone="muted">เธเธดเธ”เนเธเนเธเธฒเธ</AdminStatusBadge>
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
                            เนเธเนเนเธ
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

