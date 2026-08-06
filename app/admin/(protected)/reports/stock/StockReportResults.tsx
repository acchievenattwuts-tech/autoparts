import Link from "next/link";

import {
  queryStockRows,
  type ARAPStockFilters,
} from "@/lib/ar-ap-stock-report-queries";

/**
 * The awaited half of the stock-on-hand report (p50 ~304ms over 925 SKUs).
 * The summary cards are derived from the same rows, so they stream with it.
 */

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

export default async function StockReportResults({ filters }: { filters: ARAPStockFilters }) {
  const products = await queryStockRows(filters);

  const totalValue = products.reduce((sum, product) => sum + product.stockValue, 0);
  const zeroStockCount = products.filter((product) => product.stock === 0).length;

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950">
          <p className="text-xs text-gray-500 dark:text-slate-400">จำนวน SKU</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{products.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-[#1e3a5f]/5 p-4 shadow-sm dark:border-sky-300/20 dark:bg-sky-950/20">
          <p className="text-xs text-gray-600 dark:text-slate-300">มูลค่าสต็อกรวม</p>
          <p className="font-kanit text-2xl font-bold text-[#1e3a5f] dark:text-sky-200">
            ฿{formatCurrency(totalValue)}
          </p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm dark:border-amber-300/20 dark:bg-amber-950/20">
          <p className="text-xs text-amber-700 dark:text-amber-200">สินค้าสต็อก 0</p>
          <p className="font-kanit text-2xl font-bold text-amber-700 dark:text-amber-200">
            {zeroStockCount}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950">
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
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
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
                      className={`hover:bg-gray-50 dark:hover:bg-white/5 ${isLow ? "bg-rose-50/40 dark:bg-rose-950/20" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-200">
                        <Link href={`/admin/products/${product.id}`} className="hover:underline">
                          {product.code}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-800 dark:text-slate-100">
                        {product.name}
                        {isLow && (
                          <span className="ml-2 rounded-full bg-rose-100 px-1.5 py-0.5 text-xs text-rose-700 dark:bg-rose-400/10 dark:text-rose-200">
                            ใกล้ขั้นต่ำ
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{product.categoryName}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{product.unitName}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${
                          product.stock === 0 ? "text-gray-400 dark:text-slate-500" : "text-gray-900 dark:text-slate-100"
                        }`}
                      >
                        {formatQty(product.stock)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-300">
                        {formatCurrency(product.avgCost)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-[#1e3a5f] dark:text-sky-200">
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
  );
}
