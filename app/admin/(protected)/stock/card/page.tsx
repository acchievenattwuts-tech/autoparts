export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import RecalculateButton from "./RecalculateButton";

interface StockCardPageProps {
  searchParams: Promise<{ productId?: string; unitName?: string }>;
}

const sourceLabel: Record<string, string> = {
  BF:         "ยอดยกมา",
  PURCHASE:   "ซื้อเข้า",
  SALE:       "ขายออก",
  RETURN_IN:  "รับคืน",
  RETURN_OUT: "คืนซัพพลายเออร์",
  ADJUST_IN:  "ปรับเพิ่ม",
  ADJUST_OUT: "ปรับลด",
};

const sourceBadge: Record<string, string> = {
  BF:         "bg-blue-100 text-blue-700",
  PURCHASE:   "bg-green-100 text-green-700",
  SALE:       "bg-orange-100 text-orange-700",
  RETURN_IN:  "bg-teal-100 text-teal-700",
  RETURN_OUT: "bg-yellow-100 text-yellow-700",
  ADJUST_IN:  "bg-purple-100 text-purple-700",
  ADJUST_OUT: "bg-red-100 text-red-700",
};

const fmt = (n: number, digits = 4) =>
  n === 0 ? "-" : n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: digits });

const fmtPrice = (n: number) =>
  n === 0 ? "-" : n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const StockCardPage = async ({ searchParams }: StockCardPageProps) => {
  const { productId, unitName } = await searchParams;

  // Fetch product list for selector
  const products = await db.product.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      stock: true,
      avgCost: true,
      reportUnitName: true,
      units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
    },
  });

  // Selected product
  const selectedProduct = productId
    ? products.find((p) => p.id === productId) ?? null
    : null;

  // Determine display unit scale
  const selectedUnit = selectedProduct
    ? (unitName
        ? selectedProduct.units.find((u) => u.name === unitName)
        : selectedProduct.units.find((u) => u.isBase)) ?? selectedProduct.units[0]
    : null;
  const scale = selectedUnit ? Number(selectedUnit.scale) : 1;

  // Fetch stock cards for selected product
  const cards = selectedProduct
    ? await db.stockCard.findMany({
        where: { productId: selectedProduct.id },
        orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
      })
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ClipboardList size={22} className="text-[#1e3a5f]" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900">Stock Card MAVG</h1>
        </div>
        <RecalculateButton />
      </div>

      {/* Product selector */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <form method="GET" className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-48">
            <select
              name="productId"
              defaultValue={productId ?? ""}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white"
            >
              <option value="">-- เลือกสินค้า --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.code}] {p.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
          >
            ดูบัตรสต็อก
          </button>
        </form>
      </div>

      {selectedProduct && (
        <>
          {/* Product info + unit selector */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-kanit font-semibold text-gray-900 text-lg">
                  [{selectedProduct.code}] {selectedProduct.name}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  สต็อกปัจจุบัน:{" "}
                  <span className="font-medium text-gray-800">
                    {fmt(Number(selectedProduct.stock) / scale)} {selectedUnit?.name ?? selectedProduct.reportUnitName}
                  </span>
                  {" | "}ต้นทุนเฉลี่ย/หน่วยหลัก:{" "}
                  <span className="font-medium text-gray-800">
                    {fmtPrice(Number(selectedProduct.avgCost))} บาท
                  </span>
                </p>
              </div>
              {/* Unit tabs */}
              {selectedProduct.units.length > 1 && (
                <div className="flex gap-2">
                  <span className="text-xs text-gray-500 self-center">แสดงหน่วย:</span>
                  {selectedProduct.units.map((u) => (
                    <Link
                      key={u.name}
                      href={`/admin/stock/card?productId=${selectedProduct.id}&unitName=${u.name}`}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        (selectedUnit?.name ?? "") === u.name
                          ? "bg-[#1e3a5f] text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {u.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Stock card table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                ทั้งหมด <span className="font-medium text-gray-700">{cards.length} รายการ</span>
                {selectedUnit && scale !== 1 && (
                  <span className="ml-2 text-xs text-blue-600">
                    (แสดงในหน่วย: {selectedUnit.name}, scale = {scale})
                  </span>
                )}
              </p>
            </div>

            {cards.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                ยังไม่มีการเคลื่อนไหวสต็อกของสินค้านี้
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-3 px-3 font-medium text-gray-600 w-8">#</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600">วันที่</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600">เลขที่</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600">แหล่งที่มา</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600">รายละเอียด</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600">
                        จำนวนเข้า
                        <span className="block text-xs font-normal text-gray-400">({selectedUnit?.name ?? "หน่วยหลัก"})</span>
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600">
                        จำนวนออก
                        <span className="block text-xs font-normal text-gray-400">({selectedUnit?.name ?? "หน่วยหลัก"})</span>
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600">
                        คงเหลือ
                        <span className="block text-xs font-normal text-gray-400">({selectedUnit?.name ?? "หน่วยหลัก"})</span>
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600">
                        ราคาทุน/หน่วย
                        <span className="block text-xs font-normal text-gray-400">(หน่วยหลัก)</span>
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600">
                        avgCost
                        <span className="block text-xs font-normal text-gray-400">(หน่วยหลัก)</span>
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600">
                        มูลค่าคงเหลือ
                        <span className="block text-xs font-normal text-gray-400">(คงเหลือ × avgCost)</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((card, idx) => {
                      const qIn   = Number(card.qtyIn)  / scale;
                      const qOut  = Number(card.qtyOut) / scale;
                      const qBal  = Number(card.qtyBalance) / scale;
                      const pIn   = Number(card.priceIn);
                      const pBal  = Number(card.priceBalance);
                      // มูลค่าคงเหลือ = qtyBalance (base unit) × avgCost (base unit)
                      const totalValue = Number(card.qtyBalance) * pBal;

                      return (
                        <tr key={card.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-2.5 px-3 text-gray-400 text-xs">{idx + 1}</td>
                          <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">
                            {new Date(card.docDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs text-[#1e3a5f]">{card.docNo}</td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sourceBadge[card.source] ?? "bg-gray-100 text-gray-600"}`}>
                              {sourceLabel[card.source] ?? card.source}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-gray-500 text-xs max-w-40 truncate">
                            {card.detail ?? "-"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-green-700 font-medium">
                            {qIn > 0 ? fmt(qIn) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="py-2.5 px-3 text-right text-red-600 font-medium">
                            {qOut > 0 ? fmt(qOut) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-gray-900">
                            {fmt(qBal)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-600">
                            {pIn > 0 ? fmtPrice(pIn) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[#1e3a5f] font-medium">
                            {fmtPrice(pBal)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-700 font-medium">
                            {totalValue > 0
                              ? totalValue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : <span className="text-gray-300">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Summary row */}
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td colSpan={7} className="py-3 px-3 text-right text-sm font-semibold text-gray-700">
                        สต็อกคงเหลือล่าสุด
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-gray-900">
                        {fmt(Number(selectedProduct.stock) / scale)}
                        <span className="ml-1 text-xs font-normal text-gray-500">{selectedUnit?.name ?? selectedProduct.reportUnitName}</span>
                      </td>
                      <td className="py-3 px-3 text-right text-sm font-semibold text-gray-700">avgCost</td>
                      <td className="py-3 px-3 text-right font-bold text-[#1e3a5f]">
                        {fmtPrice(Number(selectedProduct.avgCost))}
                        <span className="ml-1 text-xs font-normal text-gray-500">บาท/หน่วยหลัก</span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-gray-900">
                        {(Number(selectedProduct.stock) * Number(selectedProduct.avgCost))
                          .toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <span className="ml-1 text-xs font-normal text-gray-500">บาท</span>
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-16 text-center">
          <ClipboardList size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">เลือกสินค้าเพื่อดู Stock Card MAVG</p>
        </div>
      )}
    </div>
  );
};

export default StockCardPage;
