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
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import ProductFilterForm from "./ProductFilterForm";
import { INVENTORY_TRACKING_NON_TRACKED } from "@/lib/inventory-tracking";

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

  const [searchResult, categories, partsBrands, carBrands] = await Promise.all([
    searchProductIds({
      query: search,
      categoryId,
      brandId,
      carBrandId,
      carModelId,
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      order: "codeDesc",
    }),
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
      },
    }),
    searchResult.ids,
  );

  const total = searchResult.total;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">จัดการสินค้า</h1>
        {canCreate && (
          <Link
            href="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <Plus size={16} />
            เพิ่มสินค้า
          </Link>
        )}
      </div>

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

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950">
        <div className="border-b border-gray-100 px-6 py-4 dark:border-white/10">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {search ? (
              <>
                ผลการค้นหา &quot;{search}&quot;:{" "}
                <span className="font-medium text-gray-700">{total} รายการ</span>
              </>
            ) : (
              <>
                สินค้าทั้งหมด:{" "}
                <span className="font-medium text-gray-700">{total} รายการ</span>
              </>
            )}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รูป</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อสินค้า</th>
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
                  <td colSpan={11} className="py-12 text-center text-gray-400 dark:text-slate-500">
                    {search ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้า"}
                  </td>
                </tr>
              ) : (
                products.map((product) => (
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
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-200">
                          ใช้งาน
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-white/10 dark:text-slate-400">
                          ปิดใช้งาน
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
