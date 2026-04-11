export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import ReceiptSettlementPrintDocument from "@/app/admin/_components/ReceiptSettlementPrintDocument";
import AutoPrint from "@/components/shared/AutoPrint";
import { hasPermissionAccess } from "@/lib/access-control";
import { PaymentMethod } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import PrintButton from "./PrintButton";

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};

const ReceiptDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("receipts.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "receipts.update");
  const { id } = await params;

  const [receipt, contents, primaryTransferAccount] = await db.$transaction([
    db.receipt.findUnique({
      where: { id },
      include: {
        customer: true,
        cashBankAccount: { select: { name: true, bankName: true, accountNo: true } },
        user: { select: { name: true, signatureUrl: true } },
        items: {
          include: {
            sale: { select: { saleNo: true, saleDate: true, netAmount: true } },
            creditNote: { select: { cnNo: true, cnDate: true, totalAmount: true } },
          },
        },
      },
    }),
    db.siteContent.findMany({
      where: { key: { in: ["shopName", "shopPhone", "shopAddress", "shopTaxId"] } },
    }),
    db.cashBankAccount.findFirst({
      where: {
        type: "BANK",
        isActive: true,
        isPrimaryTransferAccount: true,
      },
      select: {
        name: true,
        bankName: true,
        accountNo: true,
      },
    }),
  ]);

  if (!receipt) notFound();

  const cfg = Object.fromEntries(contents.map((c) => [c.key, c.value]));
  const customerDisplay = receipt.customer?.name ?? receipt.customerName ?? "-";
  const signerDisplayName = receipt.signerName ?? receipt.user?.name ?? "-";
  const receiptSignatureUrl = receipt.signerSignatureUrl ?? receipt.user?.signatureUrl ?? null;
  const receivedTransferAccount =
    receipt.paymentMethod === PaymentMethod.TRANSFER
      ? receipt.cashBankAccount ?? primaryTransferAccount
      : null;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt, #receipt * { visibility: visible; }
          #receipt { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        <div className="mb-6 flex items-center gap-2">
          <Link
            href="/admin/receipts"
            className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
          >
            <ChevronLeft size={16} /> ใบเสร็จรับเงิน
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-700">{receipt.receiptNo}</span>
        </div>

        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-3">
              <h1 className="font-kanit text-xl font-bold text-gray-900">สรุปข้อมูลใบเสร็จ</h1>
              {receipt.status === "CANCELLED" ? (
                <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  ยกเลิกแล้ว
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  ใช้งาน
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {receipt.status === "ACTIVE" && canUpdate ? (
                <Link
                  href={`/admin/receipts/${id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
                >
                  <Pencil size={14} /> แก้ไข
                </Link>
              ) : null}
              <PrintButton />
            </div>
          </div>

          <Suspense fallback={null}>
            <AutoPrint />
          </Suspense>

          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <p className="mb-1 text-gray-500">เลขที่ใบเสร็จ</p>
              <p className="font-mono font-semibold text-[#1e3a5f]">{receipt.receiptNo}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500">วันที่</p>
              <p className="font-medium text-gray-900">
                {new Date(receipt.receiptDate).toLocaleDateString("th-TH-u-ca-gregory", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            </div>
            <div>
              <p className="mb-1 text-gray-500">ลูกค้า</p>
              {receipt.customer ? (
                <Link
                  href={`/admin/customers/${receipt.customer.id}`}
                  className="font-medium text-[#1e3a5f] hover:underline"
                >
                  {receipt.customer.name}
                </Link>
              ) : (
                <p className="font-medium text-gray-900">{receipt.customerName ?? "-"}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-gray-500">ช่องทางชำระ</p>
              <p className="font-medium text-gray-900">{paymentMethodLabel[receipt.paymentMethod]}</p>
            </div>
            {receivedTransferAccount ? (
              <div>
                <p className="mb-1 text-gray-500">บัญชีรับโอน</p>
                <p className="font-medium text-gray-900">
                  {receivedTransferAccount.bankName ?? receivedTransferAccount.name}
                </p>
                <p className="font-mono text-[#1e3a5f]">{receivedTransferAccount.accountNo ?? "-"}</p>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-gray-500">ยอดรับชำระรวม</p>
              <p className="font-kanit text-lg font-bold text-[#1e3a5f]">
                {Number(receipt.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
              </p>
            </div>
            <div>
              <p className="mb-1 text-gray-500">ผู้บันทึก</p>
              <p className="font-medium text-gray-900">{receipt.user?.name ?? "-"}</p>
            </div>
            {receipt.note ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500">หมายเหตุ</p>
                <p className="font-medium text-gray-900">{receipt.note}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm no-print">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">รายการชำระ</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">เลขที่ใบขาย</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">วันที่ใบขาย</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">ยอดใบขาย</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">ยอดที่ชำระ</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item) => {
                  const isCreditNote = Boolean(item.cnId);
                  const docNo = item.sale?.saleNo ?? item.creditNote?.cnNo ?? "-";
                  const docDate = item.sale?.saleDate ?? item.creditNote?.cnDate;
                  const docAmount = item.sale?.netAmount ?? item.creditNote?.totalAmount;

                  return (
                    <tr
                      key={item.id}
                      className={`border-t border-gray-50 ${isCreditNote ? "bg-emerald-50/30" : ""}`}
                    >
                      <td
                        className={`px-4 py-3 font-mono font-medium ${
                          isCreditNote ? "text-emerald-700" : "text-[#1e3a5f]"
                        }`}
                      >
                        {item.saleId ? (
                          <Link href={`/admin/sales/${item.saleId}`} className="hover:underline">
                            {docNo}
                          </Link>
                        ) : (
                          <span>
                            {docNo} <span className="text-xs font-normal text-emerald-600">(เครดิต CN)</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {docDate
                          ? new Date(docDate).toLocaleDateString("th-TH-u-ca-gregory", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {docAmount != null
                          ? Number(docAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
                          : "-"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          isCreditNote ? "text-emerald-700" : "text-gray-900"
                        }`}
                      >
                        {isCreditNote ? "-" : ""}
                        {Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ReceiptSettlementPrintDocument
        receipt={{ ...receipt, customerName: customerDisplay, signerSignatureUrl: receiptSignatureUrl }}
        shopConfig={{
          shopName: cfg.shopName,
          shopAddress: cfg.shopAddress,
          shopPhone: cfg.shopPhone,
          shopTaxId: cfg.shopTaxId,
        }}
        signerDisplayName={signerDisplayName}
        receivedTransferAccount={receivedTransferAccount}
        rootId="receipt"
      />
    </>
  );
};

export default ReceiptDetailPage;
