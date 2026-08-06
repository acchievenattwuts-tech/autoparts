export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: heavy transaction (StockCard + MAVG recalc) can reach 180s

import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import { db } from "@/lib/db";
import { defaultSiteConfig, type SiteConfig } from "@/lib/site-config";
import Image from "next/image";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft, ExternalLink, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";

import SharedSalesDeliveryPrintDocument from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import AutoPrint from "@/components/shared/AutoPrint";
import { hasPermissionAccess } from "@/lib/access-control";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { FulfillmentType, SalePaymentType, SaleType } from "@/lib/generated/prisma";
import { buildPromptPayQrDataUrl, getTransferDocumentState } from "@/lib/payment-qr";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getShippingTrackingUrl, SHIPPING_METHOD_LABEL, SHIPPING_STATUS_BADGE, SHIPPING_STATUS_LABEL } from "@/lib/shipping";
import { addThailandDays, formatDateThai } from "@/lib/th-date";
import { buildPrintDocumentVerifyBadge } from "@/lib/verify-token";
import PrintButton from "./PrintButton";
import TrackingLinkCopy from "./TrackingLinkCopy";

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

const paymentMethodLabel: Record<string, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};

const fmtDate = (d: Date | string) =>
  formatDateThai(d);

const fmtNum = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DELIVERY_PROOF_HISTORY_LIMIT = 20;

const saleTypeLabel: Record<SaleType, string> = {
  RETAIL: "ปลีก",
  WHOLESALE: "ส่ง",
};

const saleTypeBadge: Record<SaleType, string> = {
  RETAIL: "bg-green-100 text-green-700",
  WHOLESALE: "bg-blue-100 text-blue-700",
};

const fulfillmentLabel: Record<FulfillmentType, string> = {
  PICKUP: "หน้าร้าน",
  DELIVERY: "จัดส่ง",
};

const fulfillmentBadge: Record<FulfillmentType, string> = {
  PICKUP: "bg-gray-100 text-gray-600",
  DELIVERY: "bg-purple-100 text-purple-700",
};

const paymentTypeLabel: Record<SalePaymentType, string> = {
  CASH_SALE: "ขายสด",
  CREDIT_SALE: "ขายเชื่อ",
};

const paymentTypeBadge: Record<SalePaymentType, string> = {
  CASH_SALE: "bg-emerald-100 text-emerald-700",
  CREDIT_SALE: "bg-orange-100 text-orange-700",
};

const SaleDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("sales.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "sales.update");
  const { id } = await params;

  // Read-only page: issue the three reads on the autocommit client (no interactive
  // transaction). Each query — and the nested relation loads Prisma's interpreter
  // fans out — gets its own pooled connection, so they run in parallel instead of
  // being serialized onto a single pinned client (which both emitted the pg
  // "client.query() while already executing" warning and slowed the page).
  const [sale, siteContents, primaryTransferAccount, salePayments] = await Promise.all([
    db.sale.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: [{ lineNo: "asc" }, { id: "asc" }],
          include: {
            product: { select: { code: true, name: true, reportUnitName: true, isLotControl: true } },
            lotItems: { orderBy: { id: "asc" }, select: { lotNo: true, qty: true } },
          },
        },
        user: { select: { name: true, signatureUrl: true } },
        deliveryStaff: { select: { name: true, phone: true } },
        customer: { select: { id: true, name: true, phone: true, address: true } },
        cashBankAccount: { select: { name: true, bankName: true, accountNo: true } },
        deliveryProofs: {
          orderBy: { capturedAt: "desc" },
          take:    DELIVERY_PROOF_HISTORY_LIMIT,
          select: {
            id:                true,
            receiverName:      true,
            signatureImageUrl: true,
            deliveryPhotoUrl:  true,
            note:              true,
            capturedAt:        true,
            capturedByUser:    { select: { name: true } },
          },
        },
        _count: { select: { deliveryProofs: true } },
        shopeeOrderImport: { select: { id: true, orderSn: true } },
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
        id: true,
        name: true,
        bankName: true,
        accountNo: true,
        promptPayId: true,
      },
    }),
    db.documentPayment.findMany({
      where: { docType: "SALE", docId: id },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: {
        amount: true,
        cashBankAccount: { select: { name: true, type: true, bankName: true, accountNo: true } },
      },
    }),
  ]);

  if (!sale) notFound();
  const activityEvents = await getDocumentActivityTimeline("Sale", sale.id);
  const cfg = mapSiteConfig(siteContents);

  const dueDate = addThailandDays(sale.saleDate, sale.creditTerm ?? 0);
  const signerDisplayName = sale.signerName ?? sale.user?.name ?? "-";
  const signerSignatureUrl = sale.signerSignatureUrl ?? sale.user?.signatureUrl ?? null;
  const transferDocumentState = getTransferDocumentState({
    paymentType: sale.paymentType,
    netAmount: Number(sale.netAmount),
    primaryTransferAccount,
  });
  const receivedTransferAccount =
    sale.paymentType === "CASH_SALE" && sale.paymentMethod === "TRANSFER"
      ? sale.cashBankAccount ?? primaryTransferAccount
      : null;
  const transferPrimaryAccount = transferDocumentState.shouldShowTransferSection ? primaryTransferAccount : null;
  const promptPayQrDataUrl = transferDocumentState.shouldGenerateQr
    ? await buildPromptPayQrDataUrl(primaryTransferAccount?.promptPayId, transferDocumentState.qrAmount)
    : null;
  const verify = await buildPrintDocumentVerifyBadge({
    type: "sale",
    docNo: sale.saleNo,
    variant: "ORIGINAL",
  });
  const trackingHref = sale.trackingNo
    ? getShippingTrackingUrl(sale.shippingMethod ?? "NONE", sale.trackingNo)
    : null;

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
            href="/admin/sales"
            className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
          >
            <ChevronLeft size={16} /> รายการขาย
          </NavLink>
          <span className="text-gray-300 dark:text-slate-600">/</span>
          <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{sale.saleNo}</span>
        </div>

        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-white/10">
            <div className="flex items-center gap-3">
              <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">สรุปข้อมูลใบขาย</h1>
              {sale.status === "CANCELLED" ? (
                <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
              ) : (
                <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-emerald-500/20 dark:text-emerald-300">ใช้งาน</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sale.status === "ACTIVE" && canUpdate ? (
                <NavLink
                  href={`/admin/sales/${id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
                >
                  <Pencil size={14} /> แก้ไข
                </NavLink>
              ) : null}
              <PrintButton label={sale.paymentType === "CREDIT_SALE" ? "พิมพ์ใบแจ้งหนี้" : "พิมพ์ใบเสร็จ"} />
            </div>
          </div>

          <Suspense fallback={null}>
            <AutoPrint />
          </Suspense>

          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">เลขที่ใบขาย</p>
              <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{sale.saleNo}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">วันที่</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{fmtDate(sale.saleDate)}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ลูกค้า</p>
              {sale.customer ? (
                <NavLink href={`/admin/customers/${sale.customer.id}`} className="font-medium text-[#1e3a5f] hover:underline dark:text-sky-300 dark:hover:text-sky-200" hideSpinner>
                  {sale.customer.name}
                </NavLink>
              ) : (
                <p className="font-medium text-gray-900 dark:text-slate-100">{sale.customerName ?? "-"}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">เบอร์โทร</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{sale.customer?.phone ?? sale.customerPhone ?? "-"}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ประเภทการขาย</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${saleTypeBadge[sale.saleType]}`}>
                {saleTypeLabel[sale.saleType]}
              </span>
            </div>
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ประเภทการชำระ</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${paymentTypeBadge[sale.paymentType]}`}>
                {paymentTypeLabel[sale.paymentType]}
              </span>
            </div>
            {salePayments.length > 1 ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500 dark:text-slate-400">ช่องทางรับเงิน ({salePayments.length} ช่องทาง)</p>
                <div className="space-y-1">
                  {salePayments.map((payment, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5 dark:border-white/10"
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
            ) : (
              <div>
                <p className="mb-1 text-gray-500 dark:text-slate-400">ช่องทางชำระ</p>
                <p className="font-medium text-gray-900 dark:text-slate-100">
                  {sale.paymentType === "CREDIT_SALE"
                    ? "ขายเชื่อ"
                    : sale.paymentMethod
                      ? (paymentMethodLabel[sale.paymentMethod] ?? sale.paymentMethod)
                      : "-"}
                </p>
              </div>
            )}
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">การจัดส่ง</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${fulfillmentBadge[sale.fulfillmentType]}`}>
                {fulfillmentLabel[sale.fulfillmentType]}
              </span>
            </div>
            {sale.fulfillmentType === "DELIVERY" ? (
              <>
                <div>
                  <p className="mb-1 text-gray-500 dark:text-slate-400">สถานะจัดส่ง</p>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SHIPPING_STATUS_BADGE[sale.shippingStatus]}`}>
                    {SHIPPING_STATUS_LABEL[sale.shippingStatus]}
                  </span>
                </div>
                <div>
                  <p className="mb-1 text-gray-500 dark:text-slate-400">ขนส่ง</p>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{SHIPPING_METHOD_LABEL[sale.shippingMethod ?? "NONE"]}</p>
                </div>
                <div>
                  <p className="mb-1 text-gray-500 dark:text-slate-400">พนักงานส่ง</p>
                  {sale.deliveryStaff?.name ? (
                    <>
                      <p className="font-medium text-gray-900 dark:text-slate-100">{sale.deliveryStaff.name}</p>
                      {sale.deliveryStaff.phone ? (
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{sale.deliveryStaff.phone}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="font-medium text-gray-400 dark:text-slate-500">ยังไม่ระบุ</p>
                  )}
                </div>
                {sale.trackingNo ? (
                  <div>
                    <p className="mb-1 text-gray-500 dark:text-slate-400">เลข Tracking</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono font-medium text-gray-900 dark:text-slate-100">{sale.trackingNo}</p>
                      {trackingHref ? (
                        <a
                          href={trackingHref}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/20"
                        >
                          ติดตาม
                          <ExternalLink size={11} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {sale.shopeeOrderImport ? (
                  <div className="col-span-2 md:col-span-3">
                    <p className="mb-1 text-gray-500 dark:text-slate-400">Shopee Order</p>
                    <NavLink
                      href={`/admin/marketplace/shopee/orders/${sale.shopeeOrderImport.id}`}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 dark:bg-orange-400/10 dark:text-orange-200 dark:hover:bg-orange-400/20"
                      hideSpinner
                    >
                      {sale.shopeeOrderImport.orderSn}
                      <ExternalLink size={12} />
                    </NavLink>
                  </div>
                ) : null}
                {sale.trackingToken ? (
                  <div className="col-span-2 md:col-span-3">
                    <p className="mb-1 text-gray-500 dark:text-slate-400">ลิงก์ติดตามสำหรับลูกค้า</p>
                    <TrackingLinkCopy path={`/liff/tracking/${sale.trackingToken}`} />
                  </div>
                ) : null}
              </>
            ) : null}
            <div>
              <p className="mb-1 text-gray-500 dark:text-slate-400">ผู้บันทึก</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{sale.user?.name ?? "-"}</p>
            </div>
            {sale.fulfillmentType === "DELIVERY" && sale.shippingAddress ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500 dark:text-slate-400">ที่อยู่จัดส่ง</p>
                <p className="font-medium text-gray-900 dark:text-slate-100">{sale.shippingAddress}</p>
              </div>
            ) : null}
            {sale.fulfillmentType === "DELIVERY" && sale.shippingFee !== null && Number(sale.shippingFee) > 0 ? (
              <div>
                <p className="mb-1 text-gray-500 dark:text-slate-400">ค่าจัดส่ง</p>
                <p className="font-medium text-gray-900 dark:text-slate-100">{fmtNum(Number(sale.shippingFee))} บาท</p>
              </div>
            ) : null}
            {sale.note ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500 dark:text-slate-400">หมายเหตุ</p>
                <p className="font-medium text-gray-900 dark:text-slate-100">{sale.note}</p>
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
          <SharedSalesDeliveryPrintDocument
            sale={{ ...sale, signerSignatureUrl }}
            shopConfig={cfg}
            dueDate={dueDate}
            signerDisplayName={signerDisplayName}
            transferPrimaryAccount={transferPrimaryAccount}
            receivedTransferAccount={receivedTransferAccount}
            payments={salePayments.map((payment) => ({
              accountName: payment.cashBankAccount.name,
              accountType: payment.cashBankAccount.type,
              bankName: payment.cashBankAccount.bankName,
              accountNo: payment.cashBankAccount.accountNo,
              amount: Number(payment.amount),
            }))}
            promptPayQrDataUrl={promptPayQrDataUrl}
            qrAmount={transferDocumentState.qrAmount}
            verify={verify}
            rootId="receipt"
          />
        </div>
      </div>

      <div className="no-print">
        {sale.fulfillmentType === "DELIVERY" ? (
          <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3 dark:border-white/10">
              <div>
                <h2 className="font-kanit text-lg font-bold text-gray-900 dark:text-slate-100">หลักฐานการส่ง</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  ลายเซ็น รูปหน้าบ้าน ชื่อผู้รับ และหมายเหตุจากหน้าจัดส่งมือถือ
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-slate-200">
                  {sale._count.deliveryProofs.toLocaleString("th-TH")} รายการ
                </span>
                {sale._count.deliveryProofs > DELIVERY_PROOF_HISTORY_LIMIT ? (
                  <NavLink
                    href={`/admin/sales/${sale.id}/delivery-proofs`}
                    className="inline-flex items-center rounded-full border border-[#1e3a5f]/20 px-3 py-1 text-xs font-semibold text-[#1e3a5f] hover:bg-[#1e3a5f]/5 dark:border-sky-400/30 dark:text-sky-300 dark:hover:bg-sky-400/10"
                    hideSpinner
                  >
                    ดูหลักฐานทั้งหมด
                  </NavLink>
                ) : null}
              </div>
            </div>

            {sale.deliveryProofs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                ยังไม่มีหลักฐานการส่งสำหรับใบขายนี้
              </div>
            ) : (
              <div className="space-y-4">
                {sale.deliveryProofs.map((proof) => {
                  const signatureImageSrc = toPublicStorageCdnPath(proof.signatureImageUrl) ?? proof.signatureImageUrl ?? "";
                  const deliveryPhotoSrc = toPublicStorageCdnPath(proof.deliveryPhotoUrl) ?? proof.deliveryPhotoUrl ?? "";

                  return (
                  <article
                    key={proof.id}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-slate-950"
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                          {proof.receiverName ? `ผู้รับ: ${proof.receiverName}` : "ไม่ได้ระบุชื่อผู้รับ"}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                          บันทึกโดย {proof.capturedByUser?.name ?? "-"} · {formatDateThai(proof.capturedAt)}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {proof.signatureImageUrl ? (
                        <div>
                          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">ลายเซ็นผู้รับ</p>
                          <div className="rounded-2xl border border-gray-200 bg-white p-3">
                            <Image
                              src={signatureImageSrc}
                              alt="ลายเซ็นผู้รับ"
                              width={640}
                              height={256}
                              loading="lazy"
                              className="h-32 w-full object-contain"
                              sizes="(max-width: 768px) 100vw, 50vw"
                            />
                          </div>
                        </div>
                      ) : null}

                      {proof.deliveryPhotoUrl ? (
                        <div>
                          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">รูปหลักฐานการส่ง</p>
                          <a
                            href={deliveryPhotoSrc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block overflow-hidden rounded-2xl border border-gray-200 bg-white"
                          >
                            <Image
                              src={deliveryPhotoSrc}
                              alt="รูปหลักฐานการส่ง"
                              width={1200}
                              height={900}
                              loading="lazy"
                              className="max-h-64 w-full object-cover"
                              sizes="(max-width: 768px) 100vw, 50vw"
                            />
                          </a>
                        </div>
                      ) : null}
                    </div>

                    {proof.note ? (
                      <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-gray-700 dark:bg-white/5 dark:text-slate-200">
                        {proof.note}
                      </p>
                    ) : null}
                  </article>
                  );
                })}
                {sale._count.deliveryProofs > sale.deliveryProofs.length ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-3 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-slate-950 dark:text-slate-400">
                    แสดง {sale.deliveryProofs.length.toLocaleString("th-TH")} รายการล่าสุดจากทั้งหมด{" "}
                    {sale._count.deliveryProofs.toLocaleString("th-TH")} รายการ{" "}
                    <NavLink
                      href={`/admin/sales/${sale.id}/delivery-proofs`}
                      className="font-semibold text-[#1e3a5f] hover:underline dark:text-sky-300"
                      hideSpinner
                    >
                      ดูหลักฐานทั้งหมด
                    </NavLink>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
};

export default SaleDetailPage;
