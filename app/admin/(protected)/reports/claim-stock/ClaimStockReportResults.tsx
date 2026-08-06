import Link from "next/link";

import { db } from "@/lib/db";
import { ClaimStockMovementType, type Prisma, WarrantyClaimStatus } from "@/lib/generated/prisma";
import { formatDateThai, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

import { CLAIM_STATUS_LABEL, MOVEMENT_LABEL } from "./report-labels";

/**
 * The awaited half of the claim-stock report: three queries plus the in-memory
 * sort. Kept out of page.tsx so the filter form renders before they finish.
 */



const MOVEMENT_SORT_ORDER: Record<ClaimStockMovementType, number> = {
  CUSTOMER_RETURN_IN: 1,
  SEND_TO_SUPPLIER_OUT: 2,
  SUPPLIER_RECEIVE_IN: 3,
  TRANSFER_TO_NORMAL_OUT: 4,
  SUPPLIER_REJECT: 5,
  SUPPLIER_CREDIT_SETTLE: 6,
  SCRAP_OUT: 7,
  CANCEL_REVERSAL: 8,
};

const REPORT_ROW_LIMIT = 300;

const formatQty = (value: number): string =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const formatMoney = (value: number): string =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ClaimStockReportCriteria = {
  from: string;
  to: string;
  claimStatus: WarrantyClaimStatus | "";
  movementType: ClaimStockMovementType | "";
  q: string;
};

export default async function ClaimStockReportResults({
  criteria,
}: {
  criteria: ClaimStockReportCriteria;
}) {
  const { from, to, claimStatus: selectedClaimStatus, movementType: selectedMovementType, q } = criteria;

  const dateWhere =
    from || to
      ? {
          ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
          ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
        }
      : undefined;

  const movementWhere: Prisma.ClaimStockMovementWhereInput = {
    ...(dateWhere ? { docDate: dateWhere } : {}),
    ...(selectedMovementType ? { movementType: selectedMovementType } : {}),
    claim: {
      ...(selectedClaimStatus ? { status: selectedClaimStatus } : {}),
      ...(q
        ? {
            OR: [
              { claimNo: { contains: q, mode: "insensitive" } },
              { supplierName: { contains: q, mode: "insensitive" } },
              { warranty: { product: { code: { contains: q, mode: "insensitive" } } } },
              { warranty: { product: { name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
  };

  const [movementRows, movementSummary, movementCount] = await Promise.all([
    db.claimStockMovement.findMany({
      where: movementWhere,
      orderBy: [{ claim: { claimNo: "asc" } }, { docDate: "asc" }, { createdAt: "asc" }],
      take: REPORT_ROW_LIMIT,
      select: {
        id: true,
        docNo: true,
        docDate: true,
        movementType: true,
        lotNo: true,
        qtyIn: true,
        qtyOut: true,
        unitCost: true,
        reversedAt: true,
        reversalOfId: true,
        claim: {
          select: {
            id: true,
            claimNo: true,
            status: true,
            supplierName: true,
            warranty: {
              select: {
                product: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    }),
    db.claimStockMovement.aggregate({
      where: movementWhere,
      _sum: { qtyIn: true, qtyOut: true },
    }),
    db.claimStockMovement.count({ where: movementWhere }),
  ]);

  const movements = movementRows.sort((a, b) => {
    const claimNoDiff = a.claim.claimNo.localeCompare(b.claim.claimNo);
    if (claimNoDiff !== 0) return claimNoDiff;

    const movementTypeDiff =
      MOVEMENT_SORT_ORDER[a.movementType] - MOVEMENT_SORT_ORDER[b.movementType];
    if (movementTypeDiff !== 0) return movementTypeDiff;

    const docDateDiff = a.docDate.getTime() - b.docDate.getTime();
    if (docDateDiff !== 0) return docDateDiff;

    return a.id.localeCompare(b.id);
  });

  const totalQtyIn = Number(movementSummary._sum.qtyIn ?? 0);
  const totalQtyOut = Number(movementSummary._sum.qtyOut ?? 0);
  const isResultLimited = movementCount > movements.length;
  const activeRows = movements.filter((row) => !row.reversedAt && !row.reversalOfId);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">จำนวนรายการ</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{movementCount}</p>
          {isResultLimited ? (
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              แสดง {movements.length} รายการแรก
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <p className="text-xs text-emerald-700 dark:text-emerald-300">จำนวนเข้า</p>
          <p className="font-kanit text-2xl font-bold text-emerald-700 dark:text-emerald-200">
            {formatQty(totalQtyIn)}
          </p>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 shadow-sm dark:border-orange-500/20 dark:bg-orange-500/10">
          <p className="text-xs text-orange-700 dark:text-orange-300">จำนวนออก</p>
          <p className="font-kanit text-2xl font-bold text-orange-700 dark:text-orange-200">
            {formatQty(totalQtyOut)}
          </p>
        </div>
      </div>

      {isResultLimited ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          พบข้อมูล {movementCount} รายการ ตารางแสดง {movements.length} รายการแรก ส่วนยอดสรุปด้านบนคำนวณจากข้อมูลทั้งหมดตามเงื่อนไขแล้ว
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-[#1e3a5f] text-white">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
                <th className="px-3 py-2.5 text-left font-medium">ใบเคลม</th>
                <th className="px-3 py-2.5 text-left font-medium">สินค้า</th>
                <th className="px-3 py-2.5 text-left font-medium">ซัพพลายเออร์</th>
                <th className="px-3 py-2.5 text-left font-medium">รายการ</th>
                <th className="px-3 py-2.5 text-left font-medium">เลขที่เอกสาร</th>
                <th className="px-3 py-2.5 text-left font-medium">ล็อต</th>
                <th className="px-3 py-2.5 text-right font-medium">เข้า</th>
                <th className="px-3 py-2.5 text-right font-medium">ออก</th>
                <th className="px-3 py-2.5 text-right font-medium">ต้นทุน</th>
                <th className="px-3 py-2.5 text-left font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                    ไม่พบรายการตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                movements.map((row) => {
                  const product = row.claim.warranty.product;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-200">{formatDateThai(row.docDate)}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/warranty-claims/${row.claim.id}`}
                          className="font-mono text-xs text-[#1e3a5f] hover:underline dark:text-sky-300"
                        >
                          {row.claim.claimNo}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {CLAIM_STATUS_LABEL[row.claim.status]}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-200">
                        <span className="font-mono text-xs text-gray-400">{product.code}</span>
                        <p>{product.name}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{row.claim.supplierName ?? "-"}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-200">{MOVEMENT_LABEL[row.movementType]}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{row.docNo}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{row.lotNo || "-"}</td>
                      <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-300">
                        {formatQty(Number(row.qtyIn))}
                      </td>
                      <td className="px-3 py-2 text-right text-orange-700 dark:text-orange-300">
                        {formatQty(Number(row.qtyOut))}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">
                        {formatMoney(Number(row.unitCost))}
                      </td>
                      <td className="px-3 py-2">
                        {row.reversedAt ? (
                          <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-500 dark:bg-red-500/10 dark:text-red-300">
                            ถูกย้อนกลับ
                          </span>
                        ) : row.reversalOfId ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                            รายการย้อนกลับ
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                            ใช้งานอยู่
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {activeRows.length !== movements.length && (
        <p className="text-xs text-gray-500 dark:text-slate-400">
          หมายเหตุ: รายการที่ถูกย้อนกลับยังแสดงไว้เพื่อตรวจสอบย้อนหลัง แต่ไม่ควรนำไปนับเป็นรายการเคลื่อนไหวใช้งานปัจจุบันซ้ำ
        </p>
      )}
    </>
  );
}
