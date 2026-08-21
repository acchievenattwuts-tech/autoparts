export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import CustomerAdvancePrintDocument from "@/app/admin/_components/CustomerAdvancePrintDocument";
import PrintCopyModeToggle from "@/app/admin/_components/print/PrintCopyModeToggle";
import {
  PRINT_COPY_LABEL_DUPLICATE,
  PRINT_COPY_LABEL_ORIGINAL,
  PRINT_COPY_VISIBILITY_CSS,
  PRINT_SLIP_COPY_CLASS,
} from "@/app/admin/_components/print/shared";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AutoPrint from "@/components/shared/AutoPrint";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { formatDateThai } from "@/lib/th-date";
import CustomerAdvanceCancelButton from "../CustomerAdvanceCancelButton";
import PrintButton from "../PrintButton";

const CUSTOMER_ADVANCE_PRINT_SLIP_CLASS =
  "print-slip mx-auto flex min-h-screen max-w-[900px] flex-col bg-white p-8 text-[13px] leading-snug";

export default async function CustomerAdvanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customer_advances.view");
  const { role, permissions } = await getSessionPermissionContext();
  const { id } = await params;
  const [advance, payments, shopConfig] = await Promise.all([
    db.customerAdvance.findUnique({
      where: { id },
      include: {
        customer: true,
        user: { select: { name: true, signatureUrl: true } },
        cashBankAccount: { select: { code: true, name: true } },
        receiptItems: {
          orderBy: { lineNo: "asc" },
          include: { receipt: { select: { id: true, receiptNo: true, receiptDate: true, status: true } } },
        },
      },
    }),
    db.documentPayment.findMany({
      where: { docType: "CUSTOMER_ADVANCE", docId: id },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      include: { cashBankAccount: true },
    }),
    getSiteConfig(),
  ]);

  if (!advance) notFound();

  const activity = await getDocumentActivityTimeline("CustomerAdvance", id);
  const activeRefs = advance.receiptItems
    .filter((item) => item.receipt.status === "ACTIVE")
    .map((item) => item.receipt.receiptNo);
  const canUpdate = hasPermissionAccess(role, permissions, "customer_advances.update");
  const canCancel = hasPermissionAccess(role, permissions, "customer_advances.cancel");
  const printDocumentProps = {
    advance: { ...advance, totalAmount: Number(advance.totalAmount) },
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
      accountType: row.cashBankAccount.type,
      bankName: row.cashBankAccount.bankName,
      accountNo: row.cashBankAccount.accountNo,
      amount: Number(row.amount),
    })),
  };

  return (
    <>
      <style>{`
        @page { margin: 0; }
        @media print {
          body * { visibility: hidden; }
          #customer-advance-print, #customer-advance-print * { visibility: visible; }
          #customer-advance-print, #customer-advance-print * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #customer-advance-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .print-slip {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }
          .no-print { display: none !important; }
          .receipt-footer { margin-top: auto; }
        }
${PRINT_COPY_VISIBILITY_CSS}
      `}</style>

      <div className="no-print space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/admin/customer-advances" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400">
            <ChevronLeft size={16} /> รับเงินมัดจำลูกค้า
          </Link>
          <div className="flex items-center gap-2">
            <PrintCopyModeToggle />
            <PrintButton />
            {advance.status === "ACTIVE" && canUpdate ? (
              <Link href={`/admin/customer-advances/${id}/edit`} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-white/20 dark:text-slate-300">
                <Pencil size={14} /> แก้ไข
              </Link>
            ) : null}
            {advance.status === "ACTIVE" && canCancel ? (
              <CustomerAdvanceCancelButton
                advanceId={id}
                docNo={advance.advanceNo}
                disabledReason={activeRefs.length ? `ถูกใช้ใน ${activeRefs.join(", ")}` : null}
              />
            ) : null}
          </div>
        </div>

        <Suspense fallback={null}>
          <AutoPrint />
        </Suspense>

        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <div className="mb-5 flex items-center gap-3 border-b border-gray-100 pb-3 dark:border-white/10">
            <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">รายละเอียดรับเงินมัดจำลูกค้า</h1>
            <AdminStatusBadge tone={advance.status === "ACTIVE" ? "success" : "danger"}>{advance.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}</AdminStatusBadge>
          </div>
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div><p className="text-gray-500 dark:text-slate-400">เลขที่</p><p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{advance.advanceNo}</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">วันที่</p><p className="dark:text-slate-100">{formatDateThai(advance.advanceDate)}</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">ลูกค้า</p><Link href={`/admin/customers/${advance.customerId}`} className="font-medium text-[#1e3a5f] dark:text-sky-300">{advance.customer.name}</Link></div>
            <div><p className="text-gray-500 dark:text-slate-400">ยอดมัดจำ</p><p className="text-lg font-bold dark:text-slate-100">{Number(advance.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">ใช้แล้ว</p><p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{(Number(advance.totalAmount) - Number(advance.amountRemain)).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">คงเหลือ</p><p className="text-lg font-bold text-amber-700 dark:text-amber-300">{Number(advance.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</p></div>
            {advance.note ? <div className="md:col-span-3"><p className="text-gray-500 dark:text-slate-400">หมายเหตุ</p><p className="dark:text-slate-200">{advance.note}</p></div> : null}
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <h2 className="mb-4 font-kanit text-lg font-semibold dark:text-slate-100">ใบเสร็จที่ใช้เงินมัดจำ</h2>
          {advance.receiptItems.length ? (
            <div className="space-y-2">
              {advance.receiptItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3 text-sm dark:border-white/10">
                  <Link href={`/admin/receipts/${item.receipt.id}`} className="font-mono text-[#1e3a5f] dark:text-sky-300">{item.receipt.receiptNo}</Link>
                  <span className="dark:text-slate-300">{formatDateThai(item.receipt.receiptDate)}</span>
                  <span className="font-medium dark:text-slate-100">{Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                  <AdminStatusBadge tone={item.receipt.status === "ACTIVE" ? "success" : "danger"}>{item.receipt.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}</AdminStatusBadge>
                </div>
              ))}
            </div>
          ) : <p className="py-8 text-center text-sm text-gray-400 dark:text-slate-500">ยังไม่มีใบเสร็จอ้างอิง</p>}
        </div>
      </div>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[30fr_70fr]">
        <div className="no-print xl:sticky xl:top-4">
          <DocumentActivityTimeline events={activity} variant="compact" className="mb-0" />
        </div>
        <div className="min-w-0" id="customer-advance-print">
          <CustomerAdvancePrintDocument
            {...printDocumentProps}
            copyLabel={PRINT_COPY_LABEL_ORIGINAL}
            rootClassName={CUSTOMER_ADVANCE_PRINT_SLIP_CLASS}
          />
          <CustomerAdvancePrintDocument
            {...printDocumentProps}
            copyLabel={PRINT_COPY_LABEL_DUPLICATE}
            rootClassName={`${CUSTOMER_ADVANCE_PRINT_SLIP_CLASS} ${PRINT_SLIP_COPY_CLASS}`}
          />
        </div>
      </div>
    </>
  );
}
