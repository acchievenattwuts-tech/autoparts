export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import {
  parseARAPStockFilters,
  queryStockRows,
} from "@/lib/ar-ap-stock-report-queries";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default async function StockReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");

  const params = await searchParams;
  const filters = parseARAPStockFilters(params);

  const [categories, products] = await Promise.all([
    db.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    filters.hasFilter ? queryStockRows(filters) : Promise.resolve([]),
  ]);

  const totalValue = products.reduce((sum, product) => sum + product.stockValue, 0);
  const zeroStockCount = products.filter((product) => product.stock === 0).length;
  const exportQuery = new URLSearchParams({
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.showAll === "1" ? { showAll: "1" } : {}),
  }).toString();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">Stock คงเหลือ</h1>
        <p className="text-sm text-gray-500">
          ยอดสินค้าคงเหลือปัจจุบันตามหน่วยนับรายงาน พร้อมต้นทุนเฉลี่ยและมูลค่าสต็อก
        </p>
      </div>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
      >
        <input type="hidden" name="submitted" value="1" />
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ค้นหาสินค้า
          <input
            type="text"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="ชื่อหรือรหัสสินค้า"
            className="h-9 w-[20rem] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring md:w-[28rem]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          หมวดหมู่
          <select
            name="categoryId"
            defaultValue={params.categoryId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทุกหมวดหมู่</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-1 text-xs font-medium text-gray-600">
          <input
            type="checkbox"
            name="showAll"
            value="1"
            defaultChecked={params.showAll === "1"}
            className="rounded"
          />
          รวมสินค้าสต็อก 0
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายการ
        </button>
        <Link
          href="/admin/reports/stock"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/admin/reports/export?type=stock&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=stock&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </form>

      {filters.hasFilter ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">จำนวน SKU</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">{products.length}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-[#1e3a5f]/5 p-4 shadow-sm">
              <p className="text-xs text-gray-600">มูลค่าสต็อกรวม</p>
              <p className="font-kanit text-2xl font-bold text-[#1e3a5f]">
                ฿{formatCurrency(totalValue)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
              <p className="text-xs text-amber-700">สินค้าสต็อก 0</p>
              <p className="font-kanit text-2xl font-bold text-amber-700">
                {zeroStockCount}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">รหัส</th>
                    <th className="px-3 py-2.5 text-left font-medium">ชื่อสินค้า</th>
                    <th className="px-3 py-2.5 text-left font-medium">หมวดหมู่</th>
                    <th className="px-3 py-2.5 text-left font-medium">หน่วยนับ</th>
                    <th className="px-3 py-2.5 text-right font-medium">Stock คงเหลือ</th>
                    <th className="px-3 py-2.5 text-right font-medium">ต้นทุนเฉลี่ย</th>
                    <th className="px-3 py-2.5 text-right font-medium">มูลค่า</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                        ไม่พบสินค้าตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  ) : (
                    products.map((product) => {
                      const isLow =
                        product.minStock != null && product.stock <= product.minStock;
                      return (
                        <tr
                          key={product.id}
                          className={`hover:bg-gray-50 ${isLow ? "bg-rose-50/40" : ""}`}
                        >
                          <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">
                            <Link href={`/admin/products/${product.id}`} className="hover:underline">
                              {product.code}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-gray-800">
                            {product.name}
                            {isLow && (
                              <span className="ml-2 rounded-full bg-rose-100 px-1.5 py-0.5 text-xs text-rose-700">
                                ใกล้ขั้นต่ำ
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{product.categoryName}</td>
                          <td className="px-3 py-2 text-gray-500">{product.unitName}</td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${
                              product.stock === 0 ? "text-gray-400" : "text-gray-900"
                            }`}
                          >
                            {formatQty(product.stock)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {formatCurrency(product.avgCost)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-[#1e3a5f]">
                            {formatCurrency(product.stockValue)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
          <p className="font-medium text-gray-700">ยังไม่ได้แสดงข้อมูล</p>
          <p className="mt-1 text-sm text-gray-500">
            ระบุคำค้นหา หมวดหมู่ หรือเลือก รวมสินค้าสต็อก 0 แล้วกดแสดงรายการ
          </p>
        </div>
      )}
    </div>
  );
}
