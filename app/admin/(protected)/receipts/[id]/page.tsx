export const dynamic = "force-dynamic";

import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import { db } from "@/lib/db";
import { defaultSiteConfig, type SiteConfig } from "@/lib/site-config";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";

import SharedReceiptSettlementPrintDocument from "@/app/admin/_components/SharedReceiptSettlementPrintDocument";
import AutoPrint from "@/components/shared/AutoPrint";
import { hasPermissionAccess } from "@/lib/access-control";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { PaymentMethod } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import { buildPrintDocumentVerifyBadge } from "@/lib/verify-token";
import PrintButton from "./PrintButton";

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};

const mapSiteConfig = (contents: Array<{ key: string; value: string }>): SiteConfig => {
  const map = Object.fromEntries(contents.map((item) => [item.key, item.value]));

  return {
    shopName: map["shop_name"] ?? defaultSiteConfig.shopName,
    shopSlogan: map["shop_slogan"] ?? defaultSiteConfig.shopSlogan,
    shopAddress: map["shop_address"] ?? defaultSiteConfig.shopAddress,
    shopPhone: map["shop_phone"] ?? defaultSiteConfig.shopPhone,
    shopPhoneSecondary: map["shop_phone_secondary"] ?? defaultSiteConfig.shopPhoneSecondary,
    shopEmail: map["shop_email"] ?? defaultSiteConfig.shopEmail,
    shopLineId: map["shop_line_id"] ?? defaultSiteConfig.shopLineId,
    shopLineUrl: map["shop_line_url"] ?? defaultSiteConfig.shopLineUrl,
    shopLineQrUrl: map["shop_line_qr_url"] ?? defaultSiteConfig.shopLineQrUrl,
    shopLogoUrl: map["shop_logo_url"] ?? defaultSiteConfig.shopLogoUrl,
    shopGoogleMapUrl: map["shop_google_map_url"] ?? defaultSiteConfig.shopGoogleMapUrl,
    shopGoogleMapEmbedUrl: map["shop_google_map_embed_url"] ?? defaultSiteConfig.shopGoogleMapEmbedUrl,
    shopBusinessHours: map["shop_business_hours"] ?? defaultSiteConfig.shopBusinessHours,
    shopHolidayNote: map["shop_holiday_note"] ?? defaultSiteConfig.shopHolidayNote,
    shopContactNote: map["shop_contact_note"] ?? defaultSiteConfig.shopContactNote,
    heroTitle: map["hero_title"] ?? defaultSiteConfig.heroTitle,
    heroSubtitle: map["hero_subtitle"] ?? defaultSiteConfig.heroSubtitle,
    shopWebsiteUrl: map["shop_website_url"] ?? defaultSiteConfig.shopWebsiteUrl,
    shopFacebookUrl: map["shop_facebook_url"] ?? defaultSiteConfig.shopFacebookUrl,
    shopFacebookEnabled: map["shop_facebook_enabled"] === "true",
    shopTiktokUrl: map["shop_tiktok_url"] ?? defaultSiteConfig.shopTiktokUrl,
    shopTiktokEnabled: map["shop_tiktok_enabled"] === "true",
    shopShopeeUrl: map["shop_shopee_url"] ?? defaultSiteConfig.shopShopeeUrl,
    shopShopeeEnabled: map["shop_shopee_enabled"] === "true",
    shopLazadaUrl: map["shop_lazada_url"] ?? defaultSiteConfig.shopLazadaUrl,
    shopLazadaEnabled: map["shop_lazada_enabled"] === "true",
    printNoticeText: map["print_notice_text"] ?? defaultSiteConfig.printNoticeText,
    deliveryCommissionPercent: Number(map["delivery_commission_percent"] ?? defaultSiteConfig.deliveryCommissionPercent),
    vatType: map["vat_type"] ?? defaultSiteConfig.vatType,
    vatRate: Number(map["vat_rate"] ?? defaultSiteConfig.vatRate),
    productSearchAutoApplySynonymsEnabled: defaultSiteConfig.productSearchAutoApplySynonymsEnabled,
    lineAiAutoReplyEnabled: defaultSiteConfig.lineAiAutoReplyEnabled,
    lineAiDryRun: defaultSiteConfig.lineAiDryRun,
    lineAiImageSearchEnabled: defaultSiteConfig.lineAiImageSearchEnabled,
  };
};

const ReceiptDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("receipts.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "receipts.update");
  const { id } = await params;

  // Read-only page: issue the reads on the autocommit client (no interactive
  // transaction). Each query — and the nested relation loads Prisma's interpreter
  // fans out — gets its own pooled connection, so they run in parallel instead of
  // being serialized onto a single pinned client (which both emitted the pg
  // "client.query() while already executing" warning and slowed the page).
  const [receipt, contents, primaryTransferAccount, receiptPayments] = await Promise.all([
    db.receipt.findUnique({
      where: { id },
      include: {
        customer: true,
        cashBankAccount: { select: { name: true, bankName: true, accountNo: true } },
        user: { select: { name: true, signatureUrl: true } },
        items: {
          orderBy: [{ lineNo: "asc" }, { id: "asc" }],
          include: {
            sale: { select: { saleNo: true, saleDate: true, netAmount: true } },
            creditNote: { select: { cnNo: true, cnDate: true, totalAmount: true } },
          },
        },
      },
    }),
    db.siteContent.findMany(),
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
    db.documentPayment.findMany({
      where: { docType: "RECEIPT", docId: id },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: {
        amount: true,
        cashBankAccount: { select: { name: true, code: true, type: true, bankName: true, accountNo: true } },
      },
    }),
  ]);

  if (!receipt) notFound();
  const activityEvents = await getDocumentActivityTimeline("Receipt", receipt.id);

  const cfg = mapSiteConfig(contents);
  const customerDisplay = receipt.customer?.name ?? receipt.customerName ?? "-";
  const signerDisplayName = receipt.signerName ?? receipt.user?.name ?? "-";
  const receiptSignatureUrl = receipt.signerSignatureUrl ?? receipt.user?.signatureUrl ?? null;
  const receivedTransferAccount =
    receipt.paymentMethod === PaymentMethod.TRANSFER
      ? receipt.cashBankAccount ?? primaryTransferAccount
      : null;
  const verify = await buildPrintDocumentVerifyBadge({
    type: "receipt",
    docNo: receipt.receiptNo,
    variant: "ORIGINAL",
  });

  return (
    <>
      <style>{`
        @page { margin: 0; }
        @media print {
          body * { visibility: hidden; }
          #receipt, #receipt * { visibility: visible; }
          #receipt, #receipt * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }
          .no-print { display: none !important; }
          .receipt-footer { margin-top: auto; }
        }
      `}</style>

      <div className="no-print">
        <div className="mb-6 flex items-center gap-2">
          <NavLink
            href="/admin/receipts"
            className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
          >
            <ChevronLeft size={16} /> ใบเสร็จรับเงิน
          </NavLink>
          <span className="text-gray-300 dark:text-slate-600">/</span>
          <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{receipt.receiptNo}</span>
        </div>

        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-white/10">
            <div className="flex items-center gap-3">
              <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">สรุปข้อมูลใบเสร็จ</h1>
              {receipt.status === "CANCELLED" ? (
                <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
              ) : (
                <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                  ใช้งาน
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {receipt.status === "ACTIVE" && canUpdate ? (
                <NavLink
                  href={`/admin/receipts/${id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
                >
                  <Pencil size={14} /> แก้ไข
                </NavLink>
              ) : null}
              <PrintButton />
            </div>
          </div>

          <Suspense fallback={null}>
            <AutoPrint />
          </Suspense>

          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">เลขที่ใบเสร็จ</p>
              <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{receipt.receiptNo}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">วันที่</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">
                {formatDateThai(receipt.receiptDate)}
              </p>
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ลูกค้า</p>
              {receipt.customer ? (
                <NavLink
                  href={`/admin/customers/${receipt.customer.id}`}
                  className="font-medium text-[#1e3a5f] hover:underline dark:text-sky-300 dark:hover:text-sky-200"
                  hideSpinner
                >
                  {receipt.customer.name}
                </NavLink>
              ) : (
                <p className="font-medium text-gray-900 dark:text-slate-100">{receipt.customerName ?? "-"}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ช่องทางชำระ</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{paymentMethodLabel[receipt.paymentMethod]}</p>
            </div>
            {receiptPayments.length > 1 ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500 dark:text-slate-400">ช่องทางรับเงิน ({receiptPayments.length} ช่องทาง)</p>
                <div className="space-y-1">
                  {receiptPayments.map((payment, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5 text-sm dark:border-white/10"
                    >
                      <span className="font-medium text-gray-900 dark:text-slate-100">
                        {payment.cashBankAccount.name}
                        <span className="ml-1 text-xs font-normal text-gray-500 dark:text-slate-400">
                          {payment.cashBankAccount.type === "BANK"
                            ? payment.cashBankAccount.bankName ?? "ธนาคาร"
                            : "เงินสด"}
                          {payment.cashBankAccount.accountNo ? ` | ${payment.cashBankAccount.accountNo}` : ""}
                        </span>
                      </span>
                      <span className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300">
                        {Number(payment.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : receivedTransferAccount ? (
              <div>
                <p className="mb-1 text-gray-500 dark:text-slate-400">บัญชีรับโอน</p>
                <p className="font-medium text-gray-900 dark:text-slate-100">
                  {receivedTransferAccount.bankName ?? receivedTransferAccount.name}
                </p>
                <p className="font-mono text-[#1e3a5f] dark:text-sky-300">{receivedTransferAccount.accountNo ?? "-"}</p>
                <p className="text-gray-700 dark:text-slate-300">
                  ชื่อบัญชี: <span className="font-medium text-gray-900 dark:text-slate-100">{receivedTransferAccount.name}</span>
                </p>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ยอดรับชำระรวม</p>
              <p className="font-kanit text-lg font-bold text-[#1e3a5f] dark:text-sky-300">
                {Number(receipt.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
              </p>
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ผู้บันทึก</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{receipt.user?.name ?? "-"}</p>
            </div>
            {receipt.note ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500 dark:text-slate-400">หมายเหตุ</p>
                <p className="font-medium text-gray-900 dark:text-slate-100">{receipt.note}</p>
              </div>
            ) : null}
          </div>
        </div>

      </div>

      {/* Activity history (30%) beside the print preview (70%) on wide screens.
          Must NOT be `relative` — the print stylesheet positions #receipt absolutely. */}
      <div className="mb-6 grid items-start gap-6 xl:grid-cols-[30fr_70fr]">
        <div className="no-print xl:sticky xl:top-4">
          <DocumentActivityTimeline events={activityEvents} variant="compact" className="mb-0" />
        </div>

        <div className="min-w-0">
          <SharedReceiptSettlementPrintDocument
            receipt={{ ...receipt, customerName: customerDisplay, signerSignatureUrl: receiptSignatureUrl }}
            shopConfig={{
              shopName: cfg.shopName,
              shopAddress: cfg.shopAddress,
              shopPhone: cfg.shopPhone,
              shopLogoUrl: cfg.shopLogoUrl,
              shopWebsiteUrl: cfg.shopWebsiteUrl,
              shopLineId: cfg.shopLineId,
              printNoticeText: cfg.printNoticeText,
            }}
            signerDisplayName={signerDisplayName}
            receivedTransferAccount={receivedTransferAccount}
            payments={receiptPayments.map((payment) => ({
              accountName: payment.cashBankAccount.name,
              accountType: payment.cashBankAccount.type,
              bankName: payment.cashBankAccount.bankName,
              accountNo: payment.cashBankAccount.accountNo,
              amount: Number(payment.amount),
            }))}
            verify={verify}
            rootId="receipt"
          />
        </div>
      </div>

      <div className="no-print">
        <div className="no-print overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <div className="border-b border-gray-100 px-6 py-4 dark:border-white/10">
            <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-200">รายการชำระ</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขที่ใบขาย</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่ใบขาย</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดใบขาย</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดที่ชำระ</th>
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
                      className={`border-t border-gray-50 dark:border-white/5 ${isCreditNote ? "bg-emerald-50/30 dark:bg-emerald-500/5" : ""}`}
                    >
                      <td
                        className={`px-4 py-3 font-mono font-medium ${
                          isCreditNote ? "text-emerald-700 dark:text-emerald-400" : "text-[#1e3a5f] dark:text-sky-300"
                        }`}
                      >
                        {item.saleId ? (
                          <NavLink href={`/admin/sales/${item.saleId}`} className="hover:underline" hideSpinner>
                            {docNo}
                          </NavLink>
                        ) : (
                          <span>
                            {docNo} <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">(เครดิต CN)</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                        {docDate
                          ? formatDateThai(docDate)
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800 dark:text-slate-200">
                        {docAmount != null
                          ? Number(docAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
                          : "-"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          isCreditNote ? "text-emerald-700 dark:text-emerald-400" : "text-gray-900 dark:text-slate-100"
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
    </>
  );
};

export default ReceiptDetailPage;
