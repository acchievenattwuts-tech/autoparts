export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { buildProductSearchWhere } from "@/lib/product-search";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Activity } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ productId?: string; q?: string }>;
}

type MovementSource = "PURCHASE" | "SALE" | "PURCHASE_RETURN" | "CREDIT_NOTE";

interface LotMovement {
  date: Date;
  docNo: string;
  docLink: string;
  source: MovementSource;
  qty: number;
  direction: "in" | "out";
  isCancelled: boolean;
}

const sourceLabel: Record<MovementSource, string> = {
  PURCHASE: "ซื้อเข้า",
  SALE: "ขายออก",
  PURCHASE_RETURN: "คืนซัพพลายเออร์",
  CREDIT_NOTE: "รับคืน (CN)",
};

const sourceBadge: Record<MovementSource, string> = {
  PURCHASE: "bg-green-100 text-green-700",
  SALE: "bg-orange-100 text-orange-700",
  PURCHASE_RETURN: "bg-yellow-100 text-yellow-700",
  CREDIT_NOTE: "bg-teal-100 text-teal-700",
};

const fmt = (n: number) =>
  n === 0
    ? "-"
    : n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export default async function LotMovementPage({ searchParams }: PageProps) {
  await requirePermission("lot_reports.view");

  const { productId, q } = await searchParams;
  const normalizedQuery = q?.trim() ?? "";
  const productSearchWhere = buildProductSearchWhere(normalizedQuery);
  const productSelect = {
    id: true,
    code: true,
    name: true,
    saleUnitName: true,
    stock: true,
  } as const;

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

  // Fetch lot data for selected product
  type LotEntry = {
    pl: { productId: string; lotNo: string; expDate: Date | null; mfgDate: Date | null };
    movements: LotMovement[];
    balance: number;
  };

  let lotData: LotEntry[] = [];

  if (selectedProduct) {
    const productLots = await db.productLot.findMany({
      where: { productId: selectedProduct.id },
      select: { productId: true, lotNo: true, expDate: true, mfgDate: true },
      orderBy: { lotNo: "asc" },
    });
    const lotNos = productLots.map((lot) => lot.lotNo);

    if (lotNos.length > 0) {
      const [purchaseLots, saleLots, returnLots, cnLots, lotBalances] = await Promise.all([
        db.purchaseItemLot.findMany({
          where: { lotNo: { in: lotNos }, purchaseItem: { productId: selectedProduct.id } },
          select: {
            lotNo: true,
            qty: true,
            purchaseItem: {
              select: {
                purchase: {
                  select: { id: true, purchaseNo: true, purchaseDate: true, status: true },
                },
              },
            },
          },
        }),
        db.saleItemLot.findMany({
          where: { lotNo: { in: lotNos }, saleItem: { productId: selectedProduct.id } },
          select: {
            lotNo: true,
            qty: true,
            saleItem: {
              select: {
                sale: { select: { id: true, saleNo: true, saleDate: true, status: true } },
              },
            },
          },
        }),
        db.purchaseReturnItemLot.findMany({
          where: { lotNo: { in: lotNos }, purchaseReturnItem: { productId: selectedProduct.id } },
          select: {
            lotNo: true,
            qty: true,
            purchaseReturnItem: {
              select: {
                purchaseReturn: {
                  select: { id: true, returnNo: true, returnDate: true, status: true },
                },
              },
            },
          },
        }),
        db.creditNoteItemLot.findMany({
          where: { lotNo: { in: lotNos }, creditNoteItem: { productId: selectedProduct.id } },
          select: {
            lotNo: true,
            qty: true,
            creditNoteItem: {
              select: {
                creditNote: { select: { id: true, cnNo: true, cnDate: true, status: true } },
              },
            },
          },
        }),
        db.lotBalance.findMany({
          where: { productId: selectedProduct.id, lotNo: { in: lotNos } },
          select: { lotNo: true, qtyOnHand: true },
        }),
      ]);

      const movementMap = new Map<string, LotMovement[]>();
      const pushMovement = (lotNo: string, movement: LotMovement) => {
        const existing = movementMap.get(lotNo);
        if (existing) {
          existing.push(movement);
        } else {
          movementMap.set(lotNo, [movement]);
        }
      };

      for (const row of purchaseLots) {
        pushMovement(row.lotNo, {
          date: row.purchaseItem.purchase.purchaseDate,
          docNo: row.purchaseItem.purchase.purchaseNo,
          docLink: `/admin/purchases/${row.purchaseItem.purchase.id}`,
          source: "PURCHASE",
          qty: Number(row.qty),
          direction: "in",
          isCancelled: row.purchaseItem.purchase.status === "CANCELLED",
        });
      }

      for (const row of saleLots) {
        pushMovement(row.lotNo, {
          date: row.saleItem.sale.saleDate,
          docNo: row.saleItem.sale.saleNo,
          docLink: `/admin/sales/${row.saleItem.sale.id}`,
          source: "SALE",
          qty: Number(row.qty),
          direction: "out",
          isCancelled: row.saleItem.sale.status === "CANCELLED",
        });
      }

      for (const row of returnLots) {
        pushMovement(row.lotNo, {
          date: row.purchaseReturnItem.purchaseReturn.returnDate,
          docNo: row.purchaseReturnItem.purchaseReturn.returnNo,
          docLink: `/admin/purchase-returns/${row.purchaseReturnItem.purchaseReturn.id}`,
          source: "PURCHASE_RETURN",
          qty: Number(row.qty),
          direction: "out",
          isCancelled: row.purchaseReturnItem.purchaseReturn.status === "CANCELLED",
        });
      }

      for (const row of cnLots) {
        pushMovement(row.lotNo, {
          date: row.creditNoteItem.creditNote.cnDate,
          docNo: row.creditNoteItem.creditNote.cnNo,
          docLink: `/admin/credit-notes/${row.creditNoteItem.creditNote.id}`,
          source: "CREDIT_NOTE",
          qty: Number(row.qty),
          direction: "in",
          isCancelled: row.creditNoteItem.creditNote.status === "CANCELLED",
        });
      }

      const balanceMap = new Map(
        lotBalances.map((balance) => [balance.lotNo, Number(balance.qtyOnHand)]),
      );

      lotData = productLots.map((pl): LotEntry => ({
        pl,
        movements: (movementMap.get(pl.lotNo) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime()),
        balance: balanceMap.get(pl.lotNo) ?? 0,
      }));
    }

    // Show only lots with any movement or positive balance
    lotData = lotData.filter((d) => d.movements.length > 0 || d.balance > 0);
  }

  return (
    <div>
      {/* Product selector — same style as Stock Card MAVG */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <form method="GET" className="flex gap-3 flex-wrap">
          {productId && <input type="hidden" name="productId" value={productId} />}
          <div className="flex-1 min-w-48">
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="พิมพ์รหัสหรือชื่อสินค้าเพื่อค้นหา..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
          >
            ค้นหา
          </button>
          {(q || productId) && (
            <Link
              href="/admin/lots/trace"
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors"
            >
              ล้าง
            </Link>
          )}
        </form>

        {/* Search results list */}
        {normalizedQuery && !selectedProduct && filteredProducts.length > 0 && (
          <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
              <p className="text-xs text-gray-500">
                พบ{" "}
                <span className="font-medium text-gray-700">{filteredProducts.length} รายการ</span>{" "}
                — คลิกเพื่อเลือกสินค้า
              </p>
            </div>
            <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {filteredProducts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/admin/lots/trace?productId=${p.id}&q=${encodeURIComponent(normalizedQuery)}`}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-blue-50 transition-colors"
                  >
                    <div>
                      <span className="font-mono text-xs text-gray-500 mr-2">[{p.code}]</span>
                      <span className="text-sm text-gray-800">{p.name}</span>
                    </div>
                    <span className="text-xs text-gray-400 ml-4 whitespace-nowrap">
                      คงเหลือ {fmt(Number(p.stock))} {p.saleUnitName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {normalizedQuery && !selectedProduct && filteredProducts.length === 0 && (
          <p className="mt-3 text-sm text-gray-400">
            ไม่พบสินค้าที่ตรงกับ &quot;{q}&quot;
          </p>
        )}
      </div>

      {selectedProduct && (
        <>
          {/* Product info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
            <p className="font-semibold text-gray-900 text-lg">
              [{selectedProduct.code}] {selectedProduct.name}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              พบ <span className="font-medium text-gray-800">{lotData.length} Lot</span>
              {" | "}สต็อกรวม:{" "}
              <span className="font-medium text-gray-800">
                {fmt(Number(selectedProduct.stock))} {selectedProduct.saleUnitName}
              </span>
            </p>
          </div>

          {lotData.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <p className="text-gray-400 text-sm">ไม่พบข้อมูล Lot สำหรับสินค้านี้</p>
            </div>
          ) : (
            <div className="space-y-4">
              {lotData.map(({ pl, movements, balance }) => {
                // Compute running balance — cancelled rows don't affect balance
                let running = 0;
                const rows = movements.map((m) => {
                  if (!m.isCancelled) {
                    running += m.direction === "in" ? m.qty : -m.qty;
                  }
                  return { ...m, runningBalance: m.isCancelled ? null : running };
                });

                const totalIn = movements
                  .filter((m) => !m.isCancelled && m.direction === "in")
                  .reduce((s, m) => s + m.qty, 0);
                const totalOut = movements
                  .filter((m) => !m.isCancelled && m.direction === "out")
                  .reduce((s, m) => s + m.qty, 0);

                return (
                  <div
                    key={`${pl.productId}-${pl.lotNo}`}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
                  >
                    {/* Lot header */}
                    <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-gray-900">
                          Lot:{" "}
                          <span className="font-mono text-[#1e3a5f]">{pl.lotNo}</span>
                        </p>
                        <div className="flex flex-wrap gap-4 mt-0.5 text-xs text-gray-500">
                          {pl.mfgDate && (
                            <span>
                              MFG: {pl.mfgDate.toLocaleDateString("th-TH-u-ca-gregory")}
                            </span>
                          )}
                          {pl.expDate && (
                            <span>
                              EXP: {pl.expDate.toLocaleDateString("th-TH-u-ca-gregory")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">คงเหลือปัจจุบัน</p>
                        <p className="font-bold text-gray-900 text-lg">
                          {fmt(balance)}{" "}
                          <span className="text-sm font-normal text-gray-500">
                            {selectedProduct.saleUnitName}
                          </span>
                        </p>
                      </div>
                    </div>

                    {rows.length === 0 ? (
                      <div className="px-5 py-6 text-center text-sm text-gray-400">
                        ไม่พบความเคลื่อนไหว
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="py-2.5 px-3 text-left font-medium text-gray-600 w-8">
                                #
                              </th>
                              <th className="py-2.5 px-3 text-left font-medium text-gray-600">
                                วันที่
                              </th>
                              <th className="py-2.5 px-3 text-left font-medium text-gray-600">
                                เลขที่เอกสาร
                              </th>
                              <th className="py-2.5 px-3 text-left font-medium text-gray-600">
                                ประเภท
                              </th>
                              <th className="py-2.5 px-3 text-right font-medium text-gray-600">
                                จำนวนเข้า
                                <span className="block text-xs font-normal text-gray-400">
                                  ({selectedProduct.saleUnitName})
                                </span>
                              </th>
                              <th className="py-2.5 px-3 text-right font-medium text-gray-600">
                                จำนวนออก
                                <span className="block text-xs font-normal text-gray-400">
                                  ({selectedProduct.saleUnitName})
                                </span>
                              </th>
                              <th className="py-2.5 px-3 text-right font-medium text-gray-600">
                                คงเหลือ
                                <span className="block text-xs font-normal text-gray-400">
                                  ({selectedProduct.saleUnitName})
                                </span>
                              </th>
                              <th className="py-2.5 px-3 text-center font-medium text-gray-600">
                                สถานะ
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((m, idx) => (
                              <tr
                                key={idx}
                                className={`border-t border-gray-50 transition-colors ${
                                  m.isCancelled
                                    ? "opacity-50"
                                    : "hover:bg-gray-50"
                                }`}
                              >
                                <td className="py-2.5 px-3 text-gray-400 text-xs">{idx + 1}</td>
                                <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">
                                  {m.date.toLocaleDateString("th-TH-u-ca-gregory", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                  })}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Link
                                    href={m.docLink}
                                    className={`font-mono text-xs hover:underline ${
                                      m.isCancelled
                                        ? "text-gray-400 line-through"
                                        : "text-[#1e3a5f]"
                                    }`}
                                  >
                                    {m.docNo}
                                  </Link>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sourceBadge[m.source]}`}
                                  >
                                    {sourceLabel[m.source]}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right text-green-700 font-medium">
                                  {m.direction === "in" ? (
                                    fmt(m.qty)
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right text-red-600 font-medium">
                                  {m.direction === "out" ? (
                                    fmt(m.qty)
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-semibold text-gray-900">
                                  {m.runningBalance !== null ? (
                                    fmt(m.runningBalance)
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  {m.isCancelled ? (
                                    <span className="text-xs text-red-500">ยกเลิก</span>
                                  ) : (
                                    <span className="text-xs text-green-600">ปกติ</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                            <tr>
                              <td
                                colSpan={4}
                                className="py-2.5 px-3 text-right text-xs font-semibold text-gray-600"
                              >
                                รวมทั้งหมด
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-green-700">
                                {fmt(totalIn)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-red-600">
                                {fmt(totalOut)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-gray-900">
                                {fmt(balance)}
                                <span className="ml-1 text-xs font-normal text-gray-500">
                                  {selectedProduct.saleUnitName}
                                </span>
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {!selectedProduct && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-16 text-center">
          <Activity size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            ค้นหาสินค้าด้วยรหัสหรือชื่อเพื่อดูความเคลื่อนไหว Lot
          </p>
        </div>
      )}
    </div>
  );
}
