export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Plus, Search, Pencil } from "lucide-react";
import ToggleProductButton from "./DeleteProductButton";
import ProductImagePreview from "./ProductImagePreview";
import Pagination from "@/components/shared/Pagination";

const PAGE_SIZE = 30;

interface ProductsPageProps {
  searchParams: Promise<{ search?: string; page?: string }>;
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

  const { search, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { code: { contains: search, mode: "insensitive" as const } },
          { aliases: { some: { alias: { contains: search, mode: "insensitive" as const } } } },
          { carModels: { some: { carModel: { name: { contains: search, mode: "insensitive" as const } } } } },
          { carModels: { some: { carModel: { carBrand: { name: { contains: search, mode: "insensitive" as const } } } } } },
          { category: { name: { contains: search, mode: "insensitive" as const } } },
          { brand: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }
    : undefined;

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
      orderBy: { code: "desc" },
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
    }),
    db.product.count({ where }),
  ]);

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

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <form method="GET" className="flex gap-3">
          <div className="relative max-w-sm flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              name="search"
              defaultValue={search ?? ""}
              placeholder="ค้นหาจากชื่อสินค้า รหัส หรือคำค้นอื่น ๆ"
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]"
          >
            ค้นหา
          </button>
          {search && (
            <Link
              href="/admin/products"
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              ล้าง
            </Link>
          )}
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <p className="text-sm text-gray-500">
            {search ? (
              <>
                ผลการค้นหา &quot;{search}&quot;: <span className="font-medium text-gray-700">{total} รายการ</span>
              </>
            ) : (
              <>
                สินค้าทั้งหมด: <span className="font-medium text-gray-700">{total} รายการ</span>
              </>
            )}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">รูป</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">รหัส</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ชื่อสินค้า</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">หมวดหมู่</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ตำแหน่ง Shelf</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">ราคาขาย</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Stock</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">ประกัน</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">สถานะ</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-400">
                    {search ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้า"}
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr
                    key={product.id}
                    className={`border-t border-gray-50 transition-colors ${
                      product.isActive ? "hover:bg-gray-50" : "bg-gray-50 opacity-60"
                    }`}
                  >
                    <td className="px-4 py-3">
                      {product.imageUrl ? (
                        <ProductImagePreview src={product.imageUrl} alt={product.name} />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                          <span className="text-xs text-gray-300">ไม่มี</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-gray-700">{product.code}</td>
                    <td className="px-4 py-3 text-gray-800">
                      <p className="font-medium">{product.name}</p>
                      {product.brand && <p className="text-xs text-gray-400">{product.brand.name}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{product.category.name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {product.shelfLocation ?? <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-800">
                      {Number(product.salePrice).toLocaleString("th-TH", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`font-medium ${
                          product.stock <= product.minStock ? "text-red-600" : "text-gray-800"
                        }`}
                      >
                        {product.stock}
                      </span>
                      <span className="ml-1 text-xs text-gray-400">{product.reportUnitName}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {product.warrantyDays > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          {product.warrantyDays} วัน
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {product.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          ใช้งาน
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
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
                          <ToggleProductButton id={product.id} name={product.name} isActive={product.isActive} />
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
        searchParams={search ? { search } : {}}
      />
    </div>
  );
};

export default ProductsPage;
