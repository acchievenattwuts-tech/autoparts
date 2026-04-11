export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PrintButton from "./PrintButton";
import AutoPrint from "@/components/shared/AutoPrint";
import { PaymentMethod } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH:     "เน€เธเธดเธเธชเธ”",
  TRANSFER: "เนเธญเธเน€เธเธดเธ",
  CREDIT:   "เน€เธเธฃเธ”เธดเธ•",
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
        user:     { select: { name: true, signatureUrl: true } },
        items: {
          include: {
            sale:       { select: { saleNo: true, saleDate: true, netAmount: true } },
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
  const receiptDateText = new Date(receipt.receiptDate).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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

      {/* Admin view (no-print) */}
      <div className="no-print">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6">
          <Link
            href="/admin/receipts"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
          >
            <ChevronLeft size={16} /> เนเธเน€เธชเธฃเนเธเธฃเธฑเธเน€เธเธดเธ
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-700">{receipt.receiptNo}</span>
        </div>

        {/* Summary card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <h1 className="font-kanit text-xl font-bold text-gray-900">เธชเธฃเธธเธเธเนเธญเธกเธนเธฅเนเธเน€เธชเธฃเนเธ</h1>
              {receipt.status === "CANCELLED" ? (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">เธขเธเน€เธฅเธดเธเนเธฅเนเธง</span>
              ) : (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">เนเธเนเธเธฒเธ</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {receipt.status === "ACTIVE" && canUpdate && (
                <Link href={`/admin/receipts/${id}/edit`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] rounded-lg transition-colors">
                  <Pencil size={14} /> เนเธเนเนเธ
                </Link>
              )}
              <PrintButton />
            </div>
          </div>
          <Suspense fallback={null}><AutoPrint /></Suspense>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500 mb-1">เน€เธฅเธเธ—เธตเนเนเธเน€เธชเธฃเนเธ</p>
              <p className="font-mono font-semibold text-[#1e3a5f]">{receipt.receiptNo}</p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">เธงเธฑเธเธ—เธตเน</p>
              <p className="font-medium text-gray-900">
                {new Date(receipt.receiptDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">เธฅเธนเธเธเนเธฒ</p>
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
              <p className="text-gray-500 mb-1">เธเนเธญเธเธ—เธฒเธเธเธณเธฃเธฐ</p>
              <p className="font-medium text-gray-900">{paymentMethodLabel[receipt.paymentMethod]}</p>
            </div>
            {receivedTransferAccount ? (
              <div>
                <p className="text-gray-500 mb-1">บัญชีรับโอน</p>
                <p className="font-medium text-gray-900">{receivedTransferAccount.bankName ?? receivedTransferAccount.name}</p>
                <p className="font-mono text-[#1e3a5f]">{receivedTransferAccount.accountNo ?? "-"}</p>
              </div>
            ) : null}
            <div>
              <p className="text-gray-500 mb-1">เธขเธญเธ”เธฃเธฑเธเธเธณเธฃเธฐเธฃเธงเธก</p>
              <p className="font-kanit font-bold text-lg text-[#1e3a5f]">
                {Number(receipt.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })} เธเธฒเธ—
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">เธเธนเนเธเธฑเธเธ—เธถเธ</p>
              <p className="font-medium text-gray-900">{receipt.user?.name ?? "-"}</p>
            </div>
            {receipt.note && (
              <div className="col-span-2 md:col-span-3">
                <p className="text-gray-500 mb-1">เธซเธกเธฒเธขเน€เธซเธ•เธธ</p>
                <p className="font-medium text-gray-900">{receipt.note}</p>
              </div>
            )}
          </div>
        </div>

        {/* Items table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden no-print">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">เธฃเธฒเธขเธเธฒเธฃเธเธณเธฃเธฐ</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">เน€เธฅเธเธ—เธตเนเนเธเธเธฒเธข</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">เธงเธฑเธเธ—เธตเนเธเธฒเธข</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">เธขเธญเธ”เนเธเธเธฒเธข</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">เธขเธญเธ”เธ—เธตเนเธเธณเธฃเธฐ</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item) => {
                  const isCN   = !!item.cnId;
                  const docNo  = item.sale?.saleNo ?? item.creditNote?.cnNo ?? "-";
                  const docDate = item.sale?.saleDate ?? item.creditNote?.cnDate;
                  const docAmt  = item.sale?.netAmount ?? item.creditNote?.totalAmount;
                  return (
                    <tr key={item.id} className={`border-t border-gray-50 ${isCN ? "bg-emerald-50/30" : ""}`}>
                      <td className={`py-3 px-4 font-mono font-medium ${isCN ? "text-emerald-700" : "text-[#1e3a5f]"}`}>
                        {item.saleId ? (
                          <Link href={`/admin/sales/${item.saleId}`} className="hover:underline">{docNo}</Link>
                        ) : (
                          <span>{docNo} <span className="text-xs font-normal text-emerald-600">(เน€เธเธฃเธ”เธดเธ• CN)</span></span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {docDate ? new Date(docDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-"}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-800">
                        {docAmt != null ? Number(docAmt).toLocaleString("th-TH", { minimumFractionDigits: 2 }) : "-"}
                      </td>
                      <td className={`py-3 px-4 text-right font-medium ${isCN ? "text-emerald-700" : "text-gray-900"}`}>
                        {isCN ? "โ’" : ""}{Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Print area */}
      <div id="receipt" className="bg-white p-8 max-w-2xl mx-auto">
        {/* Shop header */}
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            {cfg.shopName ?? "เธฃเนเธฒเธเธญเธฐเนเธซเธฅเนเธฃเธ–เธขเธเธ•เน"}
          </h2>
          {cfg.shopAddress && (
            <p className="text-sm text-gray-600 mt-1">{cfg.shopAddress}</p>
          )}
          {cfg.shopPhone && (
            <p className="text-sm text-gray-600">เนเธ—เธฃ: {cfg.shopPhone}</p>
          )}
          {cfg.shopTaxId && (
            <p className="text-sm text-gray-600">เน€เธฅเธเธเธฃเธฐเธเธณเธ•เธฑเธงเธเธนเนเน€เธชเธตเธขเธ เธฒเธฉเธต: {cfg.shopTaxId}</p>
          )}
        </div>

        <div className="text-center mb-6">
          <h3 className="text-lg font-bold border-t border-b border-gray-300 py-2 inline-block px-8">
            เนเธเน€เธชเธฃเนเธเธฃเธฑเธเน€เธเธดเธ (เธฃเธฑเธเธเธณเธฃเธฐเธซเธเธตเน)
          </h3>
        </div>

        {/* Receipt info */}
        <div className="grid grid-cols-2 gap-x-4 mb-4 text-sm">
          <div>
            <span className="text-gray-600">เน€เธฅเธเธ—เธตเน: </span>
            <span className="font-semibold">{receipt.receiptNo}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-600">เธงเธฑเธเธ—เธตเน: </span>
            <span className="font-semibold">
              {new Date(receipt.receiptDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
          </div>
          <div>
            <span className="text-gray-600">เธฅเธนเธเธเนเธฒ: </span>
            <span className="font-semibold">{customerDisplay}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-600">เธเนเธญเธเธ—เธฒเธ: </span>
            <span className="font-semibold">{paymentMethodLabel[receipt.paymentMethod]}</span>
          </div>
        </div>

        {receivedTransferAccount ? (
          <div className="mb-4 border border-gray-300 p-3 text-sm">
            <p className="font-medium text-gray-900">บัญชีรับโอน</p>
            <p className="text-gray-700">{receivedTransferAccount.bankName ?? receivedTransferAccount.name}</p>
            <p className="font-mono text-[#1e3a5f]">{receivedTransferAccount.accountNo ?? "-"}</p>
          </div>
        ) : null}

        {/* Items */}
        <table className="w-full text-sm mb-4 border-collapse">
          <thead>
            <tr className="border-t border-b border-gray-300">
              <th className="text-left py-2 font-medium text-gray-700">เน€เธฅเธเธ—เธตเนเนเธเธเธฒเธข</th>
              <th className="text-left py-2 font-medium text-gray-700">เธงเธฑเธเธ—เธตเนเธเธฒเธข</th>
              <th className="text-right py-2 font-medium text-gray-700">เธขเธญเธ”เนเธเธเธฒเธข</th>
              <th className="text-right py-2 font-medium text-gray-700">เธขเธญเธ”เธ—เธตเนเธเธณเธฃเธฐ</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => {
              const isCN   = !!item.cnId;
              const docNo  = item.sale?.saleNo ?? item.creditNote?.cnNo ?? "-";
              const docDate = item.sale?.saleDate ?? item.creditNote?.cnDate;
              const docAmt  = item.sale?.netAmount ?? item.creditNote?.totalAmount;
              return (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-1.5 font-mono text-gray-800">
                    {docNo}{isCN ? " (เน€เธเธฃเธ”เธดเธ•)" : ""}
                  </td>
                  <td className="py-1.5 text-gray-700">
                    {docDate ? new Date(docDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-"}
                  </td>
                  <td className="py-1.5 text-right text-gray-800">
                    {docAmt != null ? Number(docAmt).toLocaleString("th-TH", { minimumFractionDigits: 2 }) : "-"}
                  </td>
                  <td className="py-1.5 text-right font-medium text-gray-900">
                    {isCN ? "โ’" : ""}{Number(item.paidAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Total */}
        <div className="flex justify-end mb-6">
          <div className="w-56 space-y-1 text-sm">
            <div className="flex justify-between border-t border-gray-300 pt-1 font-bold text-gray-900">
              <span>เธขเธญเธ”เธฃเธฑเธเธเธณเธฃเธฐเธฃเธงเธก</span>
              <span className="text-[#1e3a5f] text-base">
                {Number(receipt.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {receipt.note && (
          <div className="text-sm text-gray-600 mb-4">
            <span className="font-medium">เธซเธกเธฒเธขเน€เธซเธ•เธธ: </span>{receipt.note}
          </div>
        )}

        <div className="mb-6 grid grid-cols-2 gap-8 text-sm">
          <div className="text-center">
            <p className="mb-2 text-gray-600">เธเธนเนเธฃเธฑเธเน€เธเธดเธ</p>
            <div className="flex h-24 items-end justify-center border-b border-gray-300 px-4">
              {receiptSignatureUrl ? (
                <img
                  src={receiptSignatureUrl}
                  alt={`เธฅเธฒเธขเน€เธเนเธ ${signerDisplayName}`}
                  className="max-h-[72px] w-auto object-contain"
                />
              ) : null}
            </div>
            <p className="mt-2 font-medium text-gray-900">{signerDisplayName}</p>
            <p className="mt-1 text-gray-400">วันที่ {receiptDateText}</p>
          </div>

          <div className="text-center">
            <p className="mb-2 text-gray-600">เธเธนเนเธเธณเธฃเธฐเน€เธเธดเธ</p>
            <div className="h-24 border-b border-gray-300" />
            <p className="mt-2 font-medium text-gray-900">&nbsp;</p>
            <p className="mt-1 text-gray-400">วันที่ {receiptDateText}</p>
          </div>
        </div>

        <div className="text-center text-sm text-gray-500 border-t border-gray-200 pt-4">
          เธเธญเธเธเธธเธ“เธ—เธตเนเนเธเนเธเธฃเธดเธเธฒเธฃ
        </div>
      </div>
    </>
  );
};

export default ReceiptDetailPage;


