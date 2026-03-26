export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Search, Pencil } from "lucide-react";
import DeleteProductButton from "./DeleteProductButton";
import ProductImagePreview from "./ProductImagePreview";

interface ProductsPageProps {
  searchParams: Promise<{ search?: string }>;
}

const ProductsPage = async ({ searchParams }: ProductsPageProps) => {
  const { search } = await searchParams;

  const products = await db.product.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">จัดการสินค้า</h1>
        <Link
          href="/admin/products/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          เพิ่มสินค้า
        </Link>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <form method="GET" className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              name="search"
              defaultValue={search ?? ""}
              placeholder="ค้นหาจากชื่อหรือรหัสสินค้า..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
          >
            ค้นหา
          </button>
          {search && (
            <Link
              href="/admin/products"
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              ล้าง
            </Link>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-sm text-gray-500">
            {search ? (
              <>
                ผลการค้นหา &quot;{search}&quot;:{" "}
                <span className="font-medium text-gray-700">{products.length} รายการ</span>
              </>
            ) : (
              <>
                สินค้าทั้งหมด:{" "}
                <span className="font-medium text-gray-700">{products.length} รายการ</span>
              </>
            )}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">รูป</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">รหัส</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ชื่อสินค้า</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">หมวดหมู่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ตำแหน่ง Shelf</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ราคาขาย</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600">Stock</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600">ประกัน</th>
                <th className="text-center py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-400">
                    {search ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้า"}
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr
                    key={product.id}
                    className="border-t border-gray-50 hover:bg-gray-50 transition-colors"
                  >
                    {/* รูป */}
                    <td className="py-3 px-4">
                      {product.imageUrl ? (
                        <ProductImagePreview src={product.imageUrl} alt={product.name} />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-gray-300 text-xs">ไม่มี</span>
                        </div>
                      )}
                    </td>

                    {/* รหัส */}
                    <td className="py-3 px-4 text-gray-700 font-mono font-medium">
                      {product.code}
                    </td>

                    {/* ชื่อ */}
                    <td className="py-3 px-4 text-gray-800">
                      <p className="font-medium">{product.name}</p>
                      {product.brand && (
                        <p className="text-xs text-gray-400">{product.brand.name}</p>
                      )}
                    </td>

                    {/* หมวดหมู่ */}
                    <td className="py-3 px-4 text-gray-600">{product.category.name}</td>

                    {/* Shelf */}
                    <td className="py-3 px-4 text-gray-600">
                      {product.shelfLocation ?? (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>

                    {/* ราคาขาย */}
                    <td className="py-3 px-4 text-right text-gray-800 font-medium">
                      {Number(product.salePrice).toLocaleString("th-TH", {
                        minimumFractionDigits: 2,
                      })}
                    </td>

                    {/* Stock */}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`font-medium ${
                          product.stock <= product.minStock
                            ? "text-red-600"
                            : "text-gray-800"
                        }`}
                      >
                        {product.stock}
                      </span>
                      <span className="text-gray-400 text-xs ml-1">{product.reportUnitName}</span>
                    </td>

                    {/* ประกัน */}
                    <td className="py-3 px-4 text-center">
                      {product.warrantyDays > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {product.warrantyDays} วัน
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>

                    {/* สถานะ */}
                    <td className="py-3 px-4 text-center">
                      {product.isActive ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          ใช้งาน
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                          ปิดใช้งาน
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/products/${product.id}/edit`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f] hover:bg-[#163055] text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          <Pencil size={12} />
                          แก้ไข
                        </Link>
                        <DeleteProductButton id={product.id} name={product.name} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProductsPage;
