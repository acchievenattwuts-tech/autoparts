export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";

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

  const hasFilter = params.categoryId || params.search || params.showAll;

  let categories: { id: string; name: string }[] = [];
  let products: {
    id: string;
    code: string;
    name: string;
    stock: unknown;
    avgCost: unknown;
    category: { name: string };
    minStock: number | null;
  }[] = [];

  [categories] = await Promise.all([
    db.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (hasFilter) {
    products = await db.product.findMany({
      where: {
        isActive: true,
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: "insensitive" } },
                { code: { contains: params.search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(params.showAll !== "1" ? { stock: { gt: 0 } } : {}),
      },
      orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
      take: 500,
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        avgCost: true,
        minStock: true,
        category: { select: { name: true } },
      },
    });
  }

  const totalValue = products.reduce(
    (sum, p) => sum + Number(p.stock) * Number(p.avgCost),
    0,
  );
  const totalItems = products.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">Stock คงเหลือ</h1>
        <p className="text-sm text-gray-500">ยอดสินค้าคงเหลือ ณ ปัจจุบัน พร้อมต้นทุนเฉลี่ยและมูลค่าสต็อก</p>
      </div>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ค้นหาสินค้า
          <input
            type="text"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="ชื่อหรือรหัสสินค้า"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 self-end pb-1">
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
          className="h-9 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          ล้าง
        </Link>
      </form>

      {!hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <p className="text-gray-400">เลือกเงื่อนไขแล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">จำนวน SKU</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">{totalItems}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-[#1e3a5f]/5 p-4 shadow-sm">
              <p className="text-xs text-gray-600">มูลค่าสต็อกรวม</p>
              <p className="font-kanit text-2xl font-bold text-[#1e3a5f]">฿{formatCurrency(totalValue)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-amber-50 p-4 shadow-sm">
              <p className="text-xs text-amber-700">สินค้าสต็อก 0</p>
              <p className="font-kanit text-2xl font-bold text-amber-700">
                {products.filter((p) => Number(p.stock) === 0).length}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">รหัส</th>
                    <th className="px-3 py-2 text-left font-medium">ชื่อสินค้า</th>
                    <th className="px-3 py-2 text-left font-medium">หมวดหมู่</th>
                    <th className="px-3 py-2 text-right font-medium">สต็อก (base)</th>
                    <th className="px-3 py-2 text-right font-medium">ต้นทุนเฉลี่ย</th>
                    <th className="px-3 py-2 text-right font-medium">มูลค่า</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                        ไม่พบสินค้าตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  ) : (
                    products.map((p) => {
                      const stock = Number(p.stock);
                      const avgCost = Number(p.avgCost);
                      const value = stock * avgCost;
                      const isLow = p.minStock != null && stock <= p.minStock;
                      return (
                        <tr key={p.id} className={`border-t border-gray-100 ${isLow ? "bg-rose-50/40" : ""}`}>
                          <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">
                            <Link href={`/admin/products/${p.id}`} className="hover:underline">
                              {p.code}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-gray-800">
                            {p.name}
                            {isLow && (
                              <span className="ml-2 rounded-full bg-rose-100 px-1.5 py-0.5 text-xs text-rose-700">
                                ใกล้ขั้นต่ำ
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500">{p.category.name}</td>
                          <td className={`px-3 py-2 text-right font-medium ${stock === 0 ? "text-gray-400" : "text-gray-900"}`}>
                            {formatQty(stock)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {formatCurrency(avgCost)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-[#1e3a5f]">
                            {formatCurrency(value)}
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
      )}
    </div>
  );
}
