export const dynamic = "force-dynamic";

import Link from "next/link";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { db } from "@/lib/db";
import { ClaimStockMovementType, WarrantyClaimStatus } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const CLAIM_STATUS_LABEL: Record<WarrantyClaimStatus, string> = {
  DRAFT: "รอส่งเคลม",
  SENT_TO_SUPPLIER: "ส่งซัพพลายเออร์แล้ว",
  CLOSED: "ปิดเคลม",
  RETURNED_TO_CUSTOMER: "ส่งคืนลูกค้าแล้ว",
  CANCELLED: "ยกเลิก",
};

const MOVEMENT_LABEL: Record<ClaimStockMovementType, string> = {
  CUSTOMER_RETURN_IN: "รับคืนจากลูกค้า",
  SEND_TO_SUPPLIER_OUT: "ส่งซัพพลายเออร์",
  SUPPLIER_RECEIVE_IN: "รับคืนจากซัพพลายเออร์",
  TRANSFER_TO_NORMAL_OUT: "โอนเข้าสต็อกปกติ",
  SUPPLIER_REJECT: "ซัพพลายเออร์ปฏิเสธ",
  SUPPLIER_CREDIT_SETTLE: "ผูกใบลดหนี้ซื้อ",
  SCRAP_OUT: "ตัดทิ้ง",
  CANCEL_REVERSAL: "รายการย้อนกลับ",
};

const formatQty = (value: number): string =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const formatMoney = (value: number): string =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ClaimStockReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");

  const params = await searchParams;
  const from = params.from?.trim() || "";
  const to = params.to?.trim() || "";
  const claimStatus = params.status?.trim() || "";
  const movementType = params.movementType?.trim() || "";
  const q = params.q?.trim() || "";
  const submitted = params.submitted === "1";
  const selectedClaimStatus = Object.values(WarrantyClaimStatus).includes(claimStatus as WarrantyClaimStatus)
    ? (claimStatus as WarrantyClaimStatus)
    : "";
  const selectedMovementType = Object.values(ClaimStockMovementType).includes(movementType as ClaimStockMovementType)
    ? (movementType as ClaimStockMovementType)
    : "";

  const dateWhere =
    from || to
      ? {
          ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
          ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
        }
      : undefined;

  const movements = submitted
    ? await db.claimStockMovement.findMany({
        where: {
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
        },
        orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
        take: 300,
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
      })
    : [];

  const totalQtyIn = movements.reduce((sum, row) => sum + Number(row.qtyIn), 0);
  const totalQtyOut = movements.reduce((sum, row) => sum + Number(row.qtyOut), 0);
  const activeRows = movements.filter((row) => !row.reversedAt && !row.reversalOfId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
          รายงานสต็อกเคลม
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          ตรวจสอบรายการเคลื่อนไหวของสินค้าเคลมหลายใบ พร้อมสถานะใบเคลมและต้นทุนที่บันทึกไว้
        </p>
      </div>

      <AdminSearchForm
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900"
      >
        <input type="hidden" name="submitted" value="1" />
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          สถานะใบเคลม
          <select
            name="status"
            defaultValue={selectedClaimStatus}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          >
            <option value="">ทุกสถานะ</option>
            {Object.entries(CLAIM_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ประเภทรายการ
          <select
            name="movementType"
            defaultValue={selectedMovementType}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          >
            <option value="">ทุกรายการ</option>
            {Object.entries(MOVEMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ค้นหา
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="เลขที่เคลม / สินค้า / ซัพพลายเออร์"
            className="h-9 w-[18rem] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950"
          />
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]">
          แสดงรายงาน
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/claim-stock"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ล้าง
        </Link>
      </AdminSearchForm>

      {submitted ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <p className="text-xs text-gray-500 dark:text-slate-400">จำนวนรายการ</p>
              <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{movements.length}</p>
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
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="font-medium text-gray-700 dark:text-slate-200">ยังไม่ได้แสดงรายงาน</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            เลือกเงื่อนไขแล้วกดแสดงรายงานเพื่อดูรายการเคลื่อนไหวของสต็อกเคลม
          </p>
        </div>
      )}
    </div>
  );
}
