export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: heavy transaction (StockCard + MAVG recalc) can reach 180s

import { db } from "@/lib/db";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { CNRefundMethod, CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";

const cnTypeLabel: Record<CreditNoteType, string> = {
  RETURN:   "รับคืนสินค้า",
  DISCOUNT: "ลดราคา",
  OTHER:    "อื่นๆ",
};

const settlementTypeLabel: Record<CNSettlementType, string> = {
  CASH_REFUND: "คืนเงินสด",
  CREDIT_DEBT: "ตั้งหนี้",
};

const refundMethodLabel: Record<CNRefundMethod, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
};

const CreditNoteDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("credit_notes.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "credit_notes.update");
  const { id } = await params;

  const cn = await db.creditNote.findUnique({
    where: { id },
    include: {
      sale: { select: { saleNo: true } },
      user: { select: { name: true } },
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        include: {
          product: { select: { code: true, name: true } },
          lotItems: { select: { lotNo: true, qty: true, isReturnLot: true } },
        },
      },
    },
  });

  if (!cn) notFound();

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <NavLink
          href="/admin/credit-notes"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> ใบลดหนี้ทั้งหมด
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{cn.cnNo}</span>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-white/10">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">ใบลดหนี้ (Credit Note)</h1>
            {cn.status === "CANCELLED" ? (
              <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
            ) : (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-emerald-500/20 dark:text-emerald-300">ใช้งาน</span>
            )}
          </div>
          {cn.status === "ACTIVE" && canUpdate && (
            <NavLink
              href={`/admin/credit-notes/${id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
            >
              <Pencil size={14} /> แก้ไข
            </NavLink>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">เลขที่ CN</p>
            <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{cn.cnNo}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">วันที่</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {formatDateThai(cn.cnDate)}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ประเภท CN</p>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              cn.type === CreditNoteType.RETURN
                ? "bg-blue-100 text-blue-700 dark:bg-sky-500/20 dark:text-sky-300"
                : "bg-yellow-100 text-yellow-700 dark:bg-amber-500/20 dark:text-amber-300"
            }`}>
              {cnTypeLabel[cn.type]}
            </span>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">การชำระ CN</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {settlementTypeLabel[cn.settlementType]}
              {cn.refundMethod && ` (${refundMethodLabel[cn.refundMethod]})`}
            </p>
          </div>
          {cn.sale && (
            <div>
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">อ้างอิงใบขาย</p>
              <NavLink
                href={`/admin/sales/${cn.saleId}`}
                className="font-mono text-[#1e3a5f] hover:underline dark:text-sky-300 dark:hover:text-sky-200"
                hideSpinner
              >
                {cn.sale.saleNo}
              </NavLink>
            </div>
          )}
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ผู้บันทึก</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{cn.user?.name ?? "-"}</p>
          </div>
          {cn.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">หมายเหตุ</p>
              <p className="text-gray-700 dark:text-slate-300">{cn.note}</p>
            </div>
          )}
          {cn.status === "CANCELLED" && cn.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">เหตุผลยกเลิก</p>
              <p className="text-red-600 dark:text-rose-400">{cn.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          รายการ
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">สินค้า</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">จำนวน</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">หน่วย</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">ราคา/หน่วย</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">รวม</th>
              </tr>
            </thead>
            <tbody>
              {cn.items.map((item) => {
                const displayScale = Number(item.unitScale ?? 1) || 1;
                const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.qty);
                const displayUnitName = item.showUnitName ?? "-";
                const displayPrice =
                  item.showPricePerUnit != null
                    ? Number(item.showPricePerUnit)
                    : Number(item.unitPrice);
                return (
                <tr key={item.id} className="border-t border-gray-50 dark:border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{item.product?.code ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-800 dark:text-slate-200">
                    <div>
                      {item.product?.name ?? "-"}
                      {item.moreDetail ? <span className="text-gray-500 dark:text-slate-400"> {item.moreDetail}</span> : null}
                    </div>
                    {item.lotItems.length > 0 && (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Lot: {item.lotItems.map((lot) => `${lot.lotNo}${lot.isReturnLot ? " [RET]" : ""} (${(Number(lot.qty) / displayScale).toLocaleString("th-TH")} ${displayUnitName})`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{displayQty.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{displayUnitName}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">
                    {displayPrice.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-slate-100">
                    {Number(item.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )})}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5">
              {cn.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={5} className="px-3 py-1 text-right text-sm text-gray-500 dark:text-slate-400">ยอดก่อนภาษี</td>
                    <td className="px-3 py-1 text-right text-gray-700 dark:text-slate-300">
                      {Number(cn.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="px-3 py-1 text-right text-sm text-gray-500 dark:text-slate-400">
                      VAT {Number(cn.vatRate)}%
                    </td>
                    <td className="px-3 py-1 text-right text-gray-700 dark:text-slate-300">
                      +{Number(cn.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={5} className="px-3 py-3 text-right font-semibold text-gray-700 dark:text-slate-300">ยอดสุทธิ</td>
                <td className="px-3 py-3 text-right text-base font-bold text-[#1e3a5f] dark:text-sky-300">
                  {Number(cn.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CreditNoteDetailPage;
