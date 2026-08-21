export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import AdvanceRefundCancelButton from "@/components/admin/AdvanceRefundCancelButton";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { DocumentPaymentDocType } from "@/lib/generated/prisma";
import {
  getSessionPermissionContext,
  requirePermission,
} from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";

export default async function SupplierAdvanceRefundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("supplier_advance_refunds.view");
  const { role, permissions } = await getSessionPermissionContext();
  const { id } = await params;
  const [refund, payments] = await Promise.all([
    db.supplierAdvanceRefund.findUnique({
      where: { id },
      include: {
        supplierAdvance: { include: { supplier: true } },
        user: { select: { name: true } },
      },
    }),
    db.documentPayment.findMany({
      where: {
        docType: DocumentPaymentDocType.SUPPLIER_ADVANCE_REFUND,
        docId: id,
      },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      include: { cashBankAccount: true },
    }),
  ]);
  if (!refund) notFound();
  const activity = await getDocumentActivityTimeline(
    "SupplierAdvanceRefund",
    id,
  );
  const canUpdate = hasPermissionAccess(
    role,
    permissions,
    "supplier_advance_refunds.update",
  );
  const canCancel = hasPermissionAccess(
    role,
    permissions,
    "supplier_advance_refunds.cancel",
  );
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/supplier-advance-refunds"
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400"
        >
          <ChevronLeft size={16} /> รับคืนเงินมัดจำซัพพลายเออร์
        </Link>
        <div className="flex items-center gap-2">
          {refund.status === "ACTIVE" && canUpdate ? (
            <Link
              href={`/admin/supplier-advance-refunds/${id}/edit`}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-white/20 dark:text-slate-300"
            >
              <Pencil size={14} /> แก้ไข
            </Link>
          ) : null}
          {refund.status === "ACTIVE" && canCancel ? (
            <AdvanceRefundCancelButton
              side="SUPPLIER"
              refundId={id}
              docNo={refund.refundNo}
            />
          ) : null}
        </div>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="mb-5 flex items-center gap-3 border-b border-gray-100 pb-3 dark:border-white/10">
          <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
            รายละเอียดรับคืนเงินมัดจำซัพพลายเออร์
          </h1>
          <AdminStatusBadge
            tone={refund.status === "ACTIVE" ? "success" : "danger"}
          >
            {refund.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}
          </AdminStatusBadge>
        </div>
        <div className="grid gap-4 text-sm md:grid-cols-3">
          <div>
            <p className="text-gray-500 dark:text-slate-400">เลขที่ CN</p>
            <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">
              {refund.refundNo}
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">วันที่</p>
            <p className="dark:text-slate-100">
              {formatDateThai(refund.refundDate)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">ซัพพลายเออร์</p>
            <p className="font-medium dark:text-slate-100">
              {refund.supplierAdvance.supplier.name}
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">
              เอกสารมัดจำต้นทาง
            </p>
            <Link
              href={`/admin/supplier-advances/${refund.supplierAdvanceId}`}
              className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300"
            >
              {refund.supplierAdvance.advanceNo}
            </Link>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">ยอดรับคืน</p>
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
              {Number(refund.refundAmount).toLocaleString("th-TH", {
                minimumFractionDigits: 2,
              })}{" "}
              บาท
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-slate-400">ยอดมัดจำคงเหลือ</p>
            <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
              {Number(refund.supplierAdvance.amountRemain).toLocaleString(
                "th-TH",
                { minimumFractionDigits: 2 },
              )}{" "}
              บาท
            </p>
          </div>
          <div className="md:col-span-3">
            <p className="text-gray-500 dark:text-slate-400">
              ช่องทางรับเงินคืน
            </p>
            <div className="mt-1 space-y-1">
              {payments.length ? (
                payments.map((row) => (
                  <div
                    key={row.id}
                    className="flex max-w-xl justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-white/10"
                  >
                    <span className="dark:text-slate-200">
                      {row.cashBankAccount.name}
                    </span>
                    <span className="font-medium dark:text-slate-100">
                      {Number(row.amount).toLocaleString("th-TH", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))
              ) : (
                <span>-</span>
              )}
            </div>
          </div>
          {refund.note ? (
            <div className="md:col-span-3">
              <p className="text-gray-500 dark:text-slate-400">หมายเหตุ</p>
              <p className="dark:text-slate-200">{refund.note}</p>
            </div>
          ) : null}
          {refund.cancelNote ? (
            <div className="md:col-span-3">
              <p className="text-gray-500 dark:text-slate-400">เหตุผลยกเลิก</p>
              <p className="text-red-600 dark:text-red-300">
                {refund.cancelNote}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      <DocumentActivityTimeline events={activity} />
    </div>
  );
}
