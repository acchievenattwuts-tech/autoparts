export const dynamic = "force-dynamic";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { buildProductSearchWhere } from "@/lib/product-search";
import { resolveReportUnit, toReportUnitPrice, toReportUnitQty } from "@/lib/report-unit";
import {
  getSessionPermissionContext,
  requirePermission,
} from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import RecalculateButton from "./RecalculateButton";

interface StockCardPageProps {
  searchParams: Promise<{ productId?: string; q?: string }>;
}

const sourceLabel: Record<string, string> = {
  BF: "ยอดยกมา",
  PURCHASE: "ซื้อเข้า",
  SALE: "ขายออก",
  RETURN_IN: "รับคืน",
  RETURN_OUT: "คืนซัพพลายเออร์",
  ADJUST_IN: "ปรับเพิ่ม",
  ADJUST_OUT: "ปรับลด",
  CLAIM_RETURN_IN: "รับคืนเคลม",
  CLAIM_REPLACE_OUT: "ส่งทดแทนเคลม",
  CLAIM_SEND_OUT: "ส่งเคลมซัพพลายเออร์",
  CLAIM_RECV_IN: "รับคืนจากซัพพลายเออร์",
};

const sourceBadge: Record<string, string> = {
  BF: "bg-blue-100 text-blue-700",
  PURCHASE: "bg-green-100 text-green-700",
  SALE: "bg-orange-100 text-orange-700",
  RETURN_IN: "bg-teal-100 text-teal-700",
  RETURN_OUT: "bg-yellow-100 text-yellow-700",
  ADJUST_IN: "bg-purple-100 text-purple-700",
  ADJUST_OUT: "bg-red-100 text-red-700",
  CLAIM_RETURN_IN: "bg-rose-100 text-rose-700",
  CLAIM_REPLACE_OUT: "bg-rose-100 text-rose-700",
  CLAIM_SEND_OUT: "bg-pink-100 text-pink-700",
  CLAIM_RECV_IN: "bg-pink-100 text-pink-700",
};

const fmtQty = (value: number) =>
  value === 0
    ? "-"
    : value.toLocaleString("th-TH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
      });

const fmtPrice = (value: number) =>
  value === 0
    ? "-"
    : value.toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });

export default async function StockCardPage({ searchParams }: StockCardPageProps) {
  await requirePermission("stock.card.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canManage = hasPermissionAccess(role, permissions, "stock.card.manage");

  const { productId, q } = await searchParams;
  const normalizedQuery = q?.trim() ?? "";
  const productSearchWhere = buildProductSearchWhere(normalizedQuery);
  const productSelect = {
    id: true,
    code: true,
    name: true,
    stock: true,
    avgCost: true,
    reportUnitName: true,
    units: {
      select: { name: true, scale: true, isBase: true },
      orderBy: [{ isBase: "desc" as const }, { scale: "asc" as const }],
    },
  };

  const [selectedProductById, filteredProducts, filteredProductCount] = await Promise.all([
    productId
      ? db.product.findUnique({
          where: { id: productId },
          select: productSelect,
        })
      : Promise.resolve(null),
    normalizedQuery && productSearchWhere
      ? db.product.findMany({
          where: productSearchWhere,
          orderBy: { code: "asc" },
          take: 50,
          select: productSelect,
        })
      : Promise.resolve([]),
    normalizedQuery && productSearchWhere
      ? db.product.count({ where: productSearchWhere })
      : Promise.resolve(0),
  ]);

  const selectedProduct = productId
    ? selectedProductById
    : normalizedQuery && filteredProductCount === 1
      ? filteredProducts[0]
      : null;

  const reportUnit = selectedProduct
    ? resolveReportUnit({
        reportUnitName: selectedProduct.reportUnitName,
        units: selectedProduct.units,
      })
    : null;

  const cards = selectedProduct
    ? await db.stockCard.findMany({
        where: { productId: selectedProduct.id },
        orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
        select: {
          id: true,
          docDate: true,
          docNo: true,
          source: true,
          detail: true,
          qtyIn: true,
          qtyOut: true,
          qtyBalance: true,
          priceIn: true,
          priceBalance: true,
        },
      })
    : [];

  const reportStock = selectedProduct && reportUnit
    ? toReportUnitQty(Number(selectedProduct.stock), reportUnit.scale)
    : 0;
  const reportAvgCost = selectedProduct && reportUnit
    ? toReportUnitPrice(Number(selectedProduct.avgCost), reportUnit.scale)
    : 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList size={22} className="text-[#1e3a5f]" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900">Stock Card MAVG</h1>
        </div>
        {canManage ? <RecalculateButton /> : null}
      </div>

      <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <form method="GET" className="flex flex-wrap gap-3">
          {productId && <input type="hidden" name="productId" value={productId} />}
          <div className="min-w-48 flex-1">
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="พิมพ์รหัสหรือชื่อสินค้าเพื่อค้นหา..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]"
          >
            ค้นหา
          </button>
          {(q || productId) && (
            <Link
              href="/admin/stock/card"
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
            >
              ล้าง
            </Link>
          )}
        </form>

        {normalizedQuery && !selectedProduct && filteredProducts.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">
                พบ <span className="font-medium text-gray-700">{filteredProducts.length} รายการ</span>
                {" "}คลิกเพื่อเลือกสินค้า
              </p>
            </div>
            <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
              {filteredProducts.map((product) => {
                const unit = resolveReportUnit({
                  reportUnitName: product.reportUnitName,
                  units: product.units,
                });
                return (
                  <li key={product.id}>
                    <Link
                      href={`/admin/stock/card?productId=${product.id}&q=${encodeURIComponent(normalizedQuery)}`}
                      className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-blue-50"
                    >
                      <div>
                        <span className="mr-2 font-mono text-xs text-gray-500">[{product.code}]</span>
                        <span className="text-sm text-gray-800">{product.name}</span>
                      </div>
                      <span className="ml-4 whitespace-nowrap text-xs text-gray-400">
                        คงเหลือ {fmtQty(toReportUnitQty(Number(product.stock), unit.scale))} {unit.unitName}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {normalizedQuery && !selectedProduct && filteredProducts.length === 0 && (
          <p className="mt-3 text-sm text-gray-400">ไม่พบสินค้าที่ตรงกับ &quot;{q}&quot;</p>
        )}
      </div>

      {selectedProduct && reportUnit && (
        <>
          <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-kanit text-lg font-semibold text-gray-900">
                  [{selectedProduct.code}] {selectedProduct.name}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  Stock คงเหลือ:{" "}
                  <span className="font-medium text-gray-800">
                    {fmtQty(reportStock)} {reportUnit.unitName}
                  </span>
                  {" | "}ต้นทุนเฉลี่ย/หน่วยรายงาน:{" "}
                  <span className="font-medium text-gray-800">
                    {fmtPrice(reportAvgCost)} บาท
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-[#1e3a5f]/5 px-3 py-2 text-xs text-[#1e3a5f]">
                หน่วยนับรายงาน: <span className="font-semibold">{reportUnit.unitName}</span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <p className="text-sm text-gray-500">
                ทั้งหมด <span className="font-medium text-gray-700">{cards.length} รายการ</span>
              </p>
            </div>

            {cards.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">
                ยังไม่มีการเคลื่อนไหวสต็อกของสินค้านี้
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-8 px-3 py-3 text-left font-medium text-gray-600">#</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-600">วันที่</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-600">เลขที่</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-600">แหล่งที่มา</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-600">รายละเอียด</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-600">หน่วยนับ</th>
                      <th className="px-3 py-3 text-right font-medium text-gray-600">จำนวนเข้า</th>
                      <th className="px-3 py-3 text-right font-medium text-gray-600">จำนวนออก</th>
                      <th className="px-3 py-3 text-right font-medium text-gray-600">คงเหลือ</th>
                      <th className="px-3 py-3 text-right font-medium text-gray-600">ราคาเข้า/หน่วย</th>
                      <th className="px-3 py-3 text-right font-medium text-gray-600">avgCost/หน่วย</th>
                      <th className="px-3 py-3 text-right font-medium text-gray-600">มูลค่าคงเหลือ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((card, index) => {
                      const qtyIn = toReportUnitQty(Number(card.qtyIn), reportUnit.scale);
                      const qtyOut = toReportUnitQty(Number(card.qtyOut), reportUnit.scale);
                      const qtyBalance = toReportUnitQty(
                        Number(card.qtyBalance),
                        reportUnit.scale,
                      );
                      const priceIn = toReportUnitPrice(Number(card.priceIn), reportUnit.scale);
                      const priceBalance = toReportUnitPrice(
                        Number(card.priceBalance),
                        reportUnit.scale,
                      );
                      const totalValue = qtyBalance * priceBalance;

                      return (
                        <tr key={card.id} className="border-t border-gray-50 transition-colors hover:bg-gray-50">
                          <td className="px-3 py-2.5 text-xs text-gray-400">{index + 1}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                    {formatDateThai(card.docDate)}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-[#1e3a5f]">
                            {card.docNo}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                sourceBadge[card.source] ?? "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {sourceLabel[card.source] ?? card.source}
                            </span>
                          </td>
                          <td className="max-w-40 px-3 py-2.5 text-xs text-gray-500">
                            <span className="line-clamp-2">{card.detail ?? "-"}</span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500">{reportUnit.unitName}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-green-700">
                            {qtyIn > 0 ? fmtQty(qtyIn) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-red-600">
                            {qtyOut > 0 ? fmtQty(qtyOut) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                            {fmtQty(qtyBalance)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-600">
                            {priceIn > 0 ? fmtPrice(priceIn) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-[#1e3a5f]">
                            {fmtPrice(priceBalance)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-gray-700">
                            {totalValue > 0
                              ? totalValue.toLocaleString("th-TH", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })
                              : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td colSpan={8} className="px-3 py-3 text-right text-sm font-semibold text-gray-700">
                        Stock คงเหลือล่าสุด
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">
                        {fmtQty(reportStock)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-gray-700">
                        ต้นทุนเฉลี่ย
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-[#1e3a5f]">
                        {fmtPrice(reportAvgCost)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">
                        {(reportStock * reportAvgCost).toLocaleString("th-TH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!selectedProduct && (
        <div className="rounded-xl border border-gray-100 bg-white p-16 text-center shadow-sm">
          <ClipboardList size={40} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">
            ค้นหาสินค้าด้วยรหัสหรือชื่อเพื่อดู Stock Card MAVG
          </p>
        </div>
      )}
    </div>
  );
}
