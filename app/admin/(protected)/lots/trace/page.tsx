export const dynamic = "force-dynamic";

import Link from "next/link";
import { Activity } from "lucide-react";
import { db } from "@/lib/db";
import { StockCardSource } from "@/lib/generated/prisma";
import { buildProductSearchWhere } from "@/lib/product-search";
import { resolveReportUnit, toReportUnitQty } from "@/lib/report-unit";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";

interface PageProps {
  searchParams: Promise<{ productId?: string; q?: string }>;
}

type MovementSource =
  | "PURCHASE"
  | "SALE"
  | "PURCHASE_RETURN"
  | "CREDIT_NOTE"
  | "CLAIM_RETURN_IN"
  | "CLAIM_SEND_OUT"
  | "CLAIM_RECV_IN"
  | "CLAIM_REPLACE_OUT";

const claimMovementSources: StockCardSource[] = [
  StockCardSource.CLAIM_RETURN_IN,
  StockCardSource.CLAIM_SEND_OUT,
  StockCardSource.CLAIM_RECV_IN,
  StockCardSource.CLAIM_REPLACE_OUT,
];

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
  CLAIM_RETURN_IN: "รับคืนเคลม",
  CLAIM_SEND_OUT: "ส่งเคลมซัพพลายเออร์",
  CLAIM_RECV_IN: "รับคืนจากซัพพลายเออร์",
  CLAIM_REPLACE_OUT: "ส่งทดแทนเคลม",
};

const sourceBadge: Record<MovementSource, string> = {
  PURCHASE: "bg-green-100 text-green-700",
  SALE: "bg-orange-100 text-orange-700",
  PURCHASE_RETURN: "bg-yellow-100 text-yellow-700",
  CREDIT_NOTE: "bg-teal-100 text-teal-700",
  CLAIM_RETURN_IN: "bg-rose-100 text-rose-700",
  CLAIM_SEND_OUT: "bg-pink-100 text-pink-700",
  CLAIM_RECV_IN: "bg-pink-100 text-pink-700",
  CLAIM_REPLACE_OUT: "bg-rose-100 text-rose-700",
};

const fmt = (value: number) =>
  value === 0
    ? "-"
    : value.toLocaleString("th-TH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
      });

export default async function LotMovementPage({ searchParams }: PageProps) {
  await requirePermission("lot_reports.view");

  const { productId, q } = await searchParams;
  const normalizedQuery = q?.trim() ?? "";
  const productSearchWhere = buildProductSearchWhere(normalizedQuery);
  const productSelect = {
    id: true,
    code: true,
    name: true,
    stock: true,
    reportUnitName: true,
    units: { select: { name: true, scale: true, isBase: true } },
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

  const reportUnit = selectedProduct
    ? resolveReportUnit({
        reportUnitName: selectedProduct.reportUnitName,
        units: selectedProduct.units,
      })
    : null;

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
      const [purchaseLots, saleLots, returnLots, cnLots, claimMovementLots, lotBalances] = await Promise.all([
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
        db.stockMovementLot.findMany({
          where: {
            lotNo: { in: lotNos },
            stockCard: {
              productId: selectedProduct.id,
              source: {
                in: claimMovementSources,
              },
            },
          },
          select: {
            lotNo: true,
            qtyIn: true,
            qtyOut: true,
            stockCard: {
              select: {
                docDate: true,
                docNo: true,
                source: true,
                referenceId: true,
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

      for (const row of claimMovementLots) {
        const qtyIn = Number(row.qtyIn);
        const qtyOut = Number(row.qtyOut);
        const direction = qtyIn > 0 ? "in" : "out";
        const qty = qtyIn > 0 ? qtyIn : qtyOut;
        let source: MovementSource;

        switch (row.stockCard.source) {
          case StockCardSource.CLAIM_RETURN_IN:
            source = "CLAIM_RETURN_IN";
            break;
          case StockCardSource.CLAIM_SEND_OUT:
            source = "CLAIM_SEND_OUT";
            break;
          case StockCardSource.CLAIM_RECV_IN:
            source = "CLAIM_RECV_IN";
            break;
          case StockCardSource.CLAIM_REPLACE_OUT:
            source = "CLAIM_REPLACE_OUT";
            break;
          default:
            continue;
        }

        if (qty <= 0) continue;

        pushMovement(row.lotNo, {
          date: row.stockCard.docDate,
          docNo: row.stockCard.docNo,
          docLink: row.stockCard.referenceId
            ? `/admin/warranty-claims/${row.stockCard.referenceId}`
            : "/admin/warranty-claims",
          source,
          qty,
          direction,
          isCancelled: false,
        });
      }

      const balanceMap = new Map(
        lotBalances.map((balance) => [balance.lotNo, Number(balance.qtyOnHand)]),
      );

      lotData = productLots.map((productLot): LotEntry => ({
        pl: productLot,
        movements: (movementMap.get(productLot.lotNo) ?? []).sort(
          (a, b) => a.date.getTime() - b.date.getTime(),
        ),
        balance: balanceMap.get(productLot.lotNo) ?? 0,
      }));
    }

    lotData = lotData.filter((item) => item.movements.length > 0 || item.balance > 0);
  }

  return (
    <div>
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
              href="/admin/lots/trace"
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
                      href={`/admin/lots/trace?productId=${product.id}&q=${encodeURIComponent(normalizedQuery)}`}
                      className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-blue-50"
                    >
                      <div>
                        <span className="mr-2 font-mono text-xs text-gray-500">[{product.code}]</span>
                        <span className="text-sm text-gray-800">{product.name}</span>
                      </div>
                      <span className="ml-4 whitespace-nowrap text-xs text-gray-400">
                        คงเหลือ {fmt(toReportUnitQty(Number(product.stock), unit.scale))} {unit.unitName}
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
            <p className="text-lg font-semibold text-gray-900">
              [{selectedProduct.code}] {selectedProduct.name}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">
              พบ <span className="font-medium text-gray-800">{lotData.length} Lot</span>
              {" | "}Stock รวม:{" "}
              <span className="font-medium text-gray-800">
                {fmt(toReportUnitQty(Number(selectedProduct.stock), reportUnit.scale))}{" "}
                {reportUnit.unitName}
              </span>
            </p>
          </div>

          {lotData.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
              <p className="text-sm text-gray-400">ไม่พบข้อมูล Lot สำหรับสินค้านี้</p>
            </div>
          ) : (
            <div className="space-y-4">
              {lotData.map(({ pl, movements, balance }) => {
                let running = 0;
                const rows = movements.map((movement) => {
                  if (!movement.isCancelled) {
                    running += movement.direction === "in" ? movement.qty : -movement.qty;
                  }
                  return {
                    ...movement,
                    runningBalance: movement.isCancelled ? null : running,
                  };
                });

                const totalIn = movements
                  .filter((movement) => !movement.isCancelled && movement.direction === "in")
                  .reduce((sum, movement) => sum + movement.qty, 0);
                const totalOut = movements
                  .filter((movement) => !movement.isCancelled && movement.direction === "out")
                  .reduce((sum, movement) => sum + movement.qty, 0);

                return (
                  <div
                    key={`${pl.productId}-${pl.lotNo}`}
                    className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 bg-gray-50 px-5 py-3">
                      <div>
                        <p className="font-semibold text-gray-900">
                          Lot: <span className="font-mono text-[#1e3a5f]">{pl.lotNo}</span>
                        </p>
                        <div className="mt-0.5 flex flex-wrap gap-4 text-xs text-gray-500">
                          <span>หน่วยนับ: {reportUnit.unitName}</span>
                          {pl.mfgDate && (
                            <span>MFG: {formatDateThai(pl.mfgDate)}</span>
                          )}
                          {pl.expDate && (
                            <span>EXP: {formatDateThai(pl.expDate)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">คงเหลือปัจจุบัน</p>
                        <p className="text-lg font-bold text-gray-900">
                          {fmt(toReportUnitQty(balance, reportUnit.scale))}{" "}
                          <span className="text-sm font-normal text-gray-500">
                            {reportUnit.unitName}
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
                              <th className="w-8 px-3 py-2.5 text-left font-medium text-gray-600">#</th>
                              <th className="px-3 py-2.5 text-left font-medium text-gray-600">วันที่</th>
                              <th className="px-3 py-2.5 text-left font-medium text-gray-600">เลขที่เอกสาร</th>
                              <th className="px-3 py-2.5 text-left font-medium text-gray-600">ประเภท</th>
                              <th className="px-3 py-2.5 text-left font-medium text-gray-600">หน่วยนับ</th>
                              <th className="px-3 py-2.5 text-right font-medium text-gray-600">จำนวนเข้า</th>
                              <th className="px-3 py-2.5 text-right font-medium text-gray-600">จำนวนออก</th>
                              <th className="px-3 py-2.5 text-right font-medium text-gray-600">คงเหลือ</th>
                              <th className="px-3 py-2.5 text-center font-medium text-gray-600">สถานะ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((movement, index) => (
                              <tr
                                key={index}
                                className={`border-t border-gray-50 transition-colors ${
                                  movement.isCancelled ? "opacity-50" : "hover:bg-gray-50"
                                }`}
                              >
                                <td className="px-3 py-2.5 text-xs text-gray-400">{index + 1}</td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                                  {formatDateThai(movement.date)}
                                </td>
                                <td className="px-3 py-2.5">
                                  <Link
                                    href={movement.docLink}
                                    className={`font-mono text-xs hover:underline ${
                                      movement.isCancelled
                                        ? "text-gray-400 line-through"
                                        : "text-[#1e3a5f]"
                                    }`}
                                  >
                                    {movement.docNo}
                                  </Link>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadge[movement.source]}`}
                                  >
                                    {sourceLabel[movement.source]}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-gray-500">{reportUnit.unitName}</td>
                                <td className="px-3 py-2.5 text-right font-medium text-green-700">
                                  {movement.direction === "in" ? (
                                    fmt(toReportUnitQty(movement.qty, reportUnit.scale))
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-right font-medium text-red-600">
                                  {movement.direction === "out" ? (
                                    fmt(toReportUnitQty(movement.qty, reportUnit.scale))
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                                  {movement.runningBalance !== null ? (
                                    fmt(toReportUnitQty(movement.runningBalance, reportUnit.scale))
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {movement.isCancelled ? (
                                    <span className="text-xs text-red-500">ยกเลิก</span>
                                  ) : (
                                    <span className="text-xs text-green-600">ปกติ</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                            <tr>
                              <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600">
                                รวมทั้งหมด
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-green-700">
                                {fmt(toReportUnitQty(totalIn, reportUnit.scale))}
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-red-600">
                                {fmt(toReportUnitQty(totalOut, reportUnit.scale))}
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-gray-900">
                                {fmt(toReportUnitQty(balance, reportUnit.scale))}
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
        <div className="rounded-xl border border-gray-100 bg-white p-16 text-center shadow-sm">
          <Activity size={40} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">
            ค้นหาสินค้าด้วยรหัสหรือชื่อเพื่อดูความเคลื่อนไหว Lot
          </p>
        </div>
      )}
    </div>
  );
}
