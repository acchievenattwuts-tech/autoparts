export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";

interface PageProps {
  searchParams: Promise<{ lotNo?: string }>;
}

export default async function LotTracePage({ searchParams }: PageProps) {
  await requirePermission("lot_reports.view");

  const { lotNo = "" } = await searchParams;
  const lotNoTrim = lotNo.trim();

  if (!lotNoTrim) {
    return (
      <div className="space-y-4">
        <SearchForm lotNo="" />
        <p className="text-sm text-muted-foreground">กรอก Lot No เพื่อค้นหาความเคลื่อนไหว</p>
      </div>
    );
  }

  // Find matching ProductLots (partial match)
  const productLots = await db.productLot.findMany({
    where: { lotNo: { contains: lotNoTrim, mode: "insensitive" } },
    include: { product: { select: { id: true, name: true, code: true, saleUnitName: true } } },
    orderBy: [{ productId: "asc" }, { lotNo: "asc" }],
    take: 20,
  });

  if (productLots.length === 0) {
    return (
      <div className="space-y-4">
        <SearchForm lotNo={lotNoTrim} />
        <p className="text-sm text-muted-foreground">ไม่พบ Lot No ที่ตรงกับ &quot;{lotNoTrim}&quot;</p>
      </div>
    );
  }

  // For each matching lot, fetch movements
  const traceData = await Promise.all(
    productLots.map(async (pl) => {
      const [purchaseLots, saleLots, returnLots, cnLots, balance] = await Promise.all([
        // Purchase lots
        db.purchaseItemLot.findMany({
          where: { lotNo: pl.lotNo, purchaseItem: { productId: pl.productId } },
          include: {
            purchaseItem: {
              select: {
                purchase: {
                  select: {
                    id: true,
                    purchaseNo: true,
                    purchaseDate: true,
                    supplier: { select: { name: true } },
                  },
                },
              },
            },
          },
        }),
        // Sale lots
        db.saleItemLot.findMany({
          where: { lotNo: pl.lotNo, saleItem: { productId: pl.productId } },
          include: {
            saleItem: {
              select: {
                sale: {
                  select: {
                    id: true,
                    saleNo: true,
                    saleDate: true,
                    customer: { select: { name: true } },
                    status: true,
                  },
                },
              },
            },
          },
        }),
        // Purchase return lots
        db.purchaseReturnItemLot.findMany({
          where: { lotNo: pl.lotNo, purchaseReturnItem: { productId: pl.productId } },
          include: {
            purchaseReturnItem: {
              select: {
                purchaseReturn: {
                  select: { id: true, returnNo: true, returnDate: true, status: true },
                },
              },
            },
          },
        }),
        // Credit note lots
        db.creditNoteItemLot.findMany({
          where: { lotNo: pl.lotNo, creditNoteItem: { productId: pl.productId } },
          include: {
            creditNoteItem: {
              select: {
                creditNote: {
                  select: { id: true, cnNo: true, cnDate: true, status: true },
                },
              },
            },
          },
        }),
        // Current balance
        db.lotBalance.findUnique({
          where: { productId_lotNo: { productId: pl.productId, lotNo: pl.lotNo } },
          select: { qtyOnHand: true },
        }),
      ]);
      return { pl, purchaseLots, saleLots, returnLots, cnLots, balance };
    })
  );

  return (
    <div className="space-y-6">
      <SearchForm lotNo={lotNoTrim} />

      {traceData.map(({ pl, purchaseLots, saleLots, returnLots, cnLots, balance }) => (
        <div key={`${pl.productId}-${pl.lotNo}`} className="rounded-lg border">
          {/* Lot header */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-t-lg bg-muted/50 px-4 py-3">
            <div>
              <p className="font-semibold">
                Lot: <span className="font-mono">{pl.lotNo}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {pl.product.code} · {pl.product.name}
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {pl.expDate && (
                <span className="text-muted-foreground">
                  EXP: {pl.expDate.toLocaleDateString("th-TH-u-ca-gregory")}
                </span>
              )}
              {pl.mfgDate && (
                <span className="text-muted-foreground">
                  MFG: {pl.mfgDate.toLocaleDateString("th-TH-u-ca-gregory")}
                </span>
              )}
              <span className="font-medium">
                คงเหลือ:{" "}
                {balance
                  ? Number(balance.qtyOnHand).toLocaleString("th-TH", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 4,
                    })
                  : "0"}{" "}
                {pl.product.saleUnitName}
              </span>
            </div>
          </div>

          <div className="divide-y p-4 space-y-4">
            {/* Purchase movements */}
            {purchaseLots.length > 0 && (
              <section className="pt-0">
                <p className="mb-2 text-sm font-semibold text-green-700">ใบซื้อต้นทาง</p>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-1 text-left font-medium">เลขที่ใบซื้อ</th>
                      <th className="pb-1 text-left font-medium">วันที่</th>
                      <th className="pb-1 text-left font-medium">ซัพพลายเออร์</th>
                      <th className="pb-1 text-right font-medium">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseLots.map((row) => (
                      <tr key={row.id}>
                        <td className="py-0.5">
                          <Link
                            href={`/admin/purchases/${row.purchaseItem.purchase.id}`}
                            className="font-mono text-blue-600 hover:underline"
                          >
                            {row.purchaseItem.purchase.purchaseNo}
                          </Link>
                        </td>
                        <td className="py-0.5">
                          {row.purchaseItem.purchase.purchaseDate.toLocaleDateString(
                            "th-TH-u-ca-gregory"
                          )}
                        </td>
                        <td className="py-0.5">
                          {row.purchaseItem.purchase.supplier?.name ?? "-"}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">
                          +{Number(row.qty).toLocaleString("th-TH", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 4,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Sale movements */}
            {saleLots.length > 0 && (
              <section className="pt-4">
                <p className="mb-2 text-sm font-semibold text-orange-700">ใบขาย</p>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-1 text-left font-medium">เลขที่ใบขาย</th>
                      <th className="pb-1 text-left font-medium">วันที่</th>
                      <th className="pb-1 text-left font-medium">ลูกค้า</th>
                      <th className="pb-1 text-right font-medium">จำนวน</th>
                      <th className="pb-1 text-center font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saleLots.map((row) => (
                      <tr key={row.id}>
                        <td className="py-0.5">
                          <Link
                            href={`/admin/sales/${row.saleItem.sale.id}`}
                            className="font-mono text-blue-600 hover:underline"
                          >
                            {row.saleItem.sale.saleNo}
                          </Link>
                        </td>
                        <td className="py-0.5">
                          {row.saleItem.sale.saleDate.toLocaleDateString("th-TH-u-ca-gregory")}
                        </td>
                        <td className="py-0.5">
                          {row.saleItem.sale.customer?.name ?? "-"}
                        </td>
                        <td className="py-0.5 text-right tabular-nums text-orange-600">
                          -{Number(row.qty).toLocaleString("th-TH", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="py-0.5 text-center">
                          {row.saleItem.sale.status === "CANCELLED" ? (
                            <span className="text-red-500">ยกเลิก</span>
                          ) : (
                            <span className="text-green-600">ปกติ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Purchase return movements */}
            {returnLots.length > 0 && (
              <section className="pt-4">
                <p className="mb-2 text-sm font-semibold text-yellow-700">คืนซัพพลายเออร์</p>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-1 text-left font-medium">เลขที่เอกสาร</th>
                      <th className="pb-1 text-left font-medium">วันที่</th>
                      <th className="pb-1 text-right font-medium">จำนวน</th>
                      <th className="pb-1 text-center font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnLots.map((row) => (
                      <tr key={row.id}>
                        <td className="py-0.5">
                          <Link
                            href={`/admin/purchase-returns/${row.purchaseReturnItem.purchaseReturn.id}`}
                            className="font-mono text-blue-600 hover:underline"
                          >
                            {row.purchaseReturnItem.purchaseReturn.returnNo}
                          </Link>
                        </td>
                        <td className="py-0.5">
                          {row.purchaseReturnItem.purchaseReturn.returnDate.toLocaleDateString(
                            "th-TH-u-ca-gregory"
                          )}
                        </td>
                        <td className="py-0.5 text-right tabular-nums text-yellow-600">
                          -{Number(row.qty).toLocaleString("th-TH", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="py-0.5 text-center">
                          {row.purchaseReturnItem.purchaseReturn.status === "CANCELLED" ? (
                            <span className="text-red-500">ยกเลิก</span>
                          ) : (
                            <span className="text-green-600">ปกติ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Credit note movements */}
            {cnLots.length > 0 && (
              <section className="pt-4">
                <p className="mb-2 text-sm font-semibold text-teal-700">Credit Note (รับคืน)</p>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-1 text-left font-medium">เลขที่ CN</th>
                      <th className="pb-1 text-left font-medium">วันที่</th>
                      <th className="pb-1 text-right font-medium">จำนวน</th>
                      <th className="pb-1 text-center font-medium">ประเภท Lot</th>
                      <th className="pb-1 text-center font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cnLots.map((row) => (
                      <tr key={row.id}>
                        <td className="py-0.5">
                          <Link
                            href={`/admin/credit-notes/${row.creditNoteItem.creditNote.id}`}
                            className="font-mono text-blue-600 hover:underline"
                          >
                            {row.creditNoteItem.creditNote.cnNo}
                          </Link>
                        </td>
                        <td className="py-0.5">
                          {row.creditNoteItem.creditNote.cnDate.toLocaleDateString(
                            "th-TH-u-ca-gregory"
                          )}
                        </td>
                        <td className="py-0.5 text-right tabular-nums text-teal-600">
                          +{Number(row.qty).toLocaleString("th-TH", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="py-0.5 text-center">
                          {row.isReturnLot ? (
                            <span className="text-purple-600">RET-lot ใหม่</span>
                          ) : (
                            <span className="text-muted-foreground">merge กลับ</span>
                          )}
                        </td>
                        <td className="py-0.5 text-center">
                          {row.creditNoteItem.creditNote.status === "CANCELLED" ? (
                            <span className="text-red-500">ยกเลิก</span>
                          ) : (
                            <span className="text-green-600">ปกติ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {purchaseLots.length === 0 &&
              saleLots.length === 0 &&
              returnLots.length === 0 &&
              cnLots.length === 0 && (
                <p className="text-sm text-muted-foreground">ไม่พบความเคลื่อนไหว</p>
              )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchForm({ lotNo }: { lotNo: string }) {
  return (
    <form method="GET" className="flex gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">ค้นหา Lot No</label>
        <input
          name="lotNo"
          defaultValue={lotNo}
          placeholder="เช่น LOT-001"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-56"
        />
      </div>
      <button
        type="submit"
        className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
      >
        ค้นหา
      </button>
    </form>
  );
}
