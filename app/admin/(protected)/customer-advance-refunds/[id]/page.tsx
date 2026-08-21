export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CustomerAdvanceRefundPrintDocument from "@/app/admin/_components/CustomerAdvanceRefundPrintDocument";
import PrintCopyModeToggle from "@/app/admin/_components/print/PrintCopyModeToggle";
import {
  PRINT_COPY_LABEL_DUPLICATE,
  PRINT_COPY_LABEL_ORIGINAL,
  PRINT_COPY_VISIBILITY_CSS,
  PRINT_SLIP_COPY_CLASS,
} from "@/app/admin/_components/print/shared";
import AdvanceRefundCancelButton from "@/components/admin/AdvanceRefundCancelButton";
import AdvanceRefundPrintButton from "@/components/admin/AdvanceRefundPrintButton";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AutoPrint from "@/components/shared/AutoPrint";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { DocumentPaymentDocType } from "@/lib/generated/prisma";
import {
  getSessionPermissionContext,
  requirePermission,
} from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { formatDateThai } from "@/lib/th-date";

const PRINT_CLASS =
  "print-slip mx-auto flex min-h-screen max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug";

export default async function CustomerAdvanceRefundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("customer_advance_refunds.view");
  const { role, permissions } = await getSessionPermissionContext();
  const { id } = await params;
  const [refund, payments, shopConfig] = await Promise.all([
    db.customerAdvanceRefund.findUnique({
      where: { id },
      include: {
        customerAdvance: { include: { customer: true } },
        user: { select: { name: true, signatureUrl: true } },
        cashBankAccount: { select: { name: true } },
      },
    }),
    db.documentPayment.findMany({
      where: {
        docType: DocumentPaymentDocType.CUSTOMER_ADVANCE_REFUND,
        docId: id,
      },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      include: { cashBankAccount: true },
    }),
    getSiteConfig(),
  ]);
  if (!refund) notFound();
  const activity = await getDocumentActivityTimeline(
    "CustomerAdvanceRefund",
    id,
  );
  const canUpdate = hasPermissionAccess(
    role,
    permissions,
    "customer_advance_refunds.update",
  );
  const canCancel = hasPermissionAccess(
    role,
    permissions,
    "customer_advance_refunds.cancel",
  );
  const printProps = {
    refund: { ...refund, refundAmount: Number(refund.refundAmount) },
    shopConfig: {
      shopName: shopConfig.shopName,
      shopAddress: shopConfig.shopAddress,
      shopPhone: shopConfig.shopPhone,
      shopLogoUrl: shopConfig.shopLogoUrl,
      shopWebsiteUrl: shopConfig.shopWebsiteUrl,
      shopLineId: shopConfig.shopLineId,
      printNoticeText: shopConfig.printNoticeText,
    },
    payments: payments.map((row) => ({
      accountName: row.cashBankAccount.name,
      bankName: row.cashBankAccount.bankName,
      accountNo: row.cashBankAccount.accountNo,
      amount: Number(row.amount),
    })),
  };
  return (
    <>
      <style>{`@page{margin:0}@media print{body *{visibility:hidden}#customer-advance-refund-print,#customer-advance-refund-print *{visibility:visible;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}#customer-advance-refund-print{position:absolute;left:0;top:0;width:100%}.print-slip{display:flex;flex-direction:column;min-height:100vh}.no-print{display:none!important}.receipt-footer{margin-top:auto}}${PRINT_COPY_VISIBILITY_CSS}`}</style>
      <div className="no-print space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/admin/customer-advance-refunds"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400"
          >
            <ChevronLeft size={16} /> คืนเงินมัดจำลูกค้า
          </Link>
          <div className="flex items-center gap-2">
            <PrintCopyModeToggle />
            <AdvanceRefundPrintButton />
            {refund.status === "ACTIVE" && canUpdate ? (
              <Link
                href={`/admin/customer-advance-refunds/${id}/edit`}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-white/20 dark:text-slate-300"
              >
                <Pencil size={14} /> แก้ไข
              </Link>
            ) : null}
            {refund.status === "ACTIVE" && canCancel ? (
              <AdvanceRefundCancelButton
                side="CUSTOMER"
                refundId={id}
                docNo={refund.refundNo}
              />
            ) : null}
          </div>
        </div>
        <Suspense fallback={null}>
          <AutoPrint />
        </Suspense>
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <div className="mb-5 flex items-center gap-3 border-b border-gray-100 pb-3 dark:border-white/10">
            <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
              รายละเอียดคืนเงินมัดจำลูกค้า
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
              <p className="text-gray-500 dark:text-slate-400">ลูกค้า</p>
              <Link
                href={`/admin/customers/${refund.customerAdvance.customerId}`}
                className="font-medium text-[#1e3a5f] dark:text-sky-300"
              >
                {refund.customerAdvance.customer.name}
              </Link>
            </div>
            <div>
              <p className="text-gray-500 dark:text-slate-400">
                เอกสารมัดจำต้นทาง
              </p>
              <Link
                href={`/admin/customer-advances/${refund.customerAdvanceId}`}
                className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300"
              >
                {refund.customerAdvance.advanceNo}
              </Link>
            </div>
            <div>
              <p className="text-gray-500 dark:text-slate-400">ยอดคืน</p>
              <p className="text-lg font-bold text-red-700 dark:text-red-300">
                {Number(refund.refundAmount).toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}{" "}
                บาท
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-slate-400">
                ยอดมัดจำคงเหลือ
              </p>
              <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                {Number(refund.customerAdvance.amountRemain).toLocaleString(
                  "th-TH",
                  { minimumFractionDigits: 2 },
                )}{" "}
                บาท
              </p>
            </div>
            <div className="md:col-span-3">
              <p className="text-gray-500 dark:text-slate-400">
                ช่องทางคืนเงิน
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
                <p className="text-gray-500 dark:text-slate-400">
                  เหตุผลยกเลิก
                </p>
                <p className="text-red-600 dark:text-red-300">
                  {refund.cancelNote}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[30fr_70fr]">
        <div className="no-print xl:sticky xl:top-4">
          <DocumentActivityTimeline
            events={activity}
            variant="compact"
            className="mb-0"
          />
        </div>
        <div id="customer-advance-refund-print" className="min-w-0">
          <CustomerAdvanceRefundPrintDocument
            {...printProps}
            copyLabel={PRINT_COPY_LABEL_ORIGINAL}
            rootClassName={PRINT_CLASS}
          />
          <CustomerAdvanceRefundPrintDocument
            {...printProps}
            copyLabel={PRINT_COPY_LABEL_DUPLICATE}
            rootClassName={`${PRINT_CLASS} ${PRINT_SLIP_COPY_CLASS}`}
          />
        </div>
      </div>
    </>
  );
}
