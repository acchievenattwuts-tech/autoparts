export const dynamic = "force-dynamic";

import { Fragment, Suspense } from "react";
import { notFound } from "next/navigation";

import SharedSalesDeliveryPrintDocument from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import PrintCopyModeToggle from "@/app/admin/_components/print/PrintCopyModeToggle";
import {
  PRINT_COPY_LABEL_DUPLICATE,
  PRINT_COPY_LABEL_ORIGINAL,
  PRINT_COPY_VISIBILITY_CSS,
  PRINT_SLIP_COPY_CLASS,
} from "@/app/admin/_components/print/shared";
import AutoPrint from "@/components/shared/AutoPrint";
import PrintButton from "./PrintButton";
import { db } from "@/lib/db";
import { buildPromptPayQrDataUrl, getTransferDocumentState } from "@/lib/payment-qr";
import { requirePermission } from "@/lib/require-auth";
import { defaultSiteConfig, type SiteConfig } from "@/lib/site-config";
import { addThailandDays } from "@/lib/th-date";
import { buildPrintDocumentVerifyBadge } from "@/lib/verify-token";

const DELIVERY_SLIP_CLASS = "slip mx-auto bg-white p-8 text-[13px] leading-snug md:flex md:min-h-[100vh] md:flex-col";

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

const DeliveryPrintPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) => {
  await requirePermission("delivery.view");
  const { ids } = await searchParams;

  if (!ids) notFound();

  const idList = ids.split(",").filter(Boolean).slice(0, 100);
  if (idList.length === 0) notFound();

  // Read-only page: issue the reads on the autocommit client (no interactive
  // transaction). Each query — and the nested relation loads Prisma's interpreter
  // fans out — gets its own pooled connection, so they run in parallel instead of
  // being serialized onto a single pinned client (which both emitted the pg
  // "client.query() while already executing" warning and slowed the page).
  const [sales, siteContents, primaryTransferAccount] = await Promise.all([
    db.sale.findMany({
      where: { id: { in: idList }, fulfillmentType: "DELIVERY", status: "ACTIVE" },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        status: true,
        customerName: true,
        customerPhone: true,
        shippingAddress: true,
        totalAmount: true,
        discount: true,
        netAmount: true,
        amountRemain: true,
        shippingFee: true,
        paymentType: true,
        paymentMethod: true,
        creditTerm: true,
        note: true,
        signerName: true,
        signerSignatureUrl: true,
        cashBankAccount: { select: { name: true, bankName: true, accountNo: true } },
        user: { select: { name: true, signatureUrl: true } },
        customer: { select: { name: true, phone: true, address: true } },
        items: {
          orderBy: [{ lineNo: "asc" }, { id: "asc" }],
          select: {
            id: true,
            quantity: true,
            salePrice: true,
            unitListPrice: true,
            lineDiscount: true,
            totalAmount: true,
            showQty: true,
            showUnitName: true,
            showPricePerUnit: true,
            unitScale: true,
            moreDetail: true,
            warrantyDays: true,
            lotItems: { orderBy: { id: "asc" }, select: { lotNo: true, qty: true } },
            product: {
              select: { code: true, name: true, reportUnitName: true },
            },
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
        id: true,
        name: true,
        bankName: true,
        accountNo: true,
        promptPayId: true,
      },
    }),
  ]);

  if (sales.length === 0) notFound();
  const shopConfig = mapSiteConfig(siteContents);

  // Batch-load split payments for all sales (avoid N+1 in the per-sale map).
  const allSalePayments = await db.documentPayment.findMany({
    where: { docType: "SALE", docId: { in: sales.map((sale) => sale.id) } },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    select: {
      docId: true,
      amount: true,
      cashBankAccount: { select: { name: true, type: true, bankName: true, accountNo: true } },
    },
  });
  const paymentsBySaleId = new Map<string, typeof allSalePayments>();
  for (const payment of allSalePayments) {
    const list = paymentsBySaleId.get(payment.docId) ?? [];
    list.push(payment);
    paymentsBySaleId.set(payment.docId, list);
  }

  return (
    <>
      <style>{`
        @page { margin: 0; }
        @media print {
          body {
            background: #ffffff !important;
            color: #111827 !important;
          }
          .no-print { display: none !important; }
          .slip, .slip * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .slip {
            width: 100%;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }
          /* ขึ้นหน้าใหม่ "ก่อน" ทุกใบยกเว้นใบแรก — ใช้แทน page-break-after + :last-child
             เพราะใบสำเนาที่ถูกซ่อนยังนับเป็น :last-child อยู่ ทำให้เกิดหน้าว่างท้ายเอกสาร */
          .slip:not(.print-slip-lead) { page-break-before: always; break-before: page; }
          .receipt-footer { margin-top: auto; }
        }
        @media screen {
          body {
            background: #f3f4f6 !important;
            color: #111827 !important;
          }
          .slip {
            max-width: 900px;
            margin: 24px auto;
            background: white;
            padding: 32px;
            border-radius: 8px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.1);
          }
        }
${PRINT_COPY_VISIBILITY_CSS}
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white p-4">
        <span className="font-medium text-gray-700">ใบส่งของ {sales.length} ใบ</span>
        <div className="flex items-center gap-2">
          <PrintCopyModeToggle />
          <PrintButton />
        </div>
      </div>

      <Suspense fallback={null}>
        <AutoPrint />
      </Suspense>

      {await Promise.all(
        sales.map(async (sale, index) => {
          const transferDocumentState = getTransferDocumentState({
            paymentType: sale.paymentType,
            netAmount: Number(sale.netAmount),
            primaryTransferAccount,
          });
          const dueDate = addThailandDays(sale.saleDate, sale.creditTerm ?? 0);
          const signerDisplayName = sale.signerName ?? sale.user?.name ?? "-";
          const receivedTransferAccount =
            sale.paymentType === "CASH_SALE" && sale.paymentMethod === "TRANSFER"
              ? sale.cashBankAccount ?? primaryTransferAccount
              : null;
          const transferPrimaryAccount = transferDocumentState.shouldShowTransferSection ? primaryTransferAccount : null;
          const [promptPayQrDataUrl, verify] = await Promise.all([
            transferDocumentState.shouldGenerateQr
              ? buildPromptPayQrDataUrl(primaryTransferAccount?.promptPayId, transferDocumentState.qrAmount)
              : Promise.resolve(null),
            buildPrintDocumentVerifyBadge({
              type: "sale",
              docNo: sale.saleNo,
            }),
          ]);
          const slipProps = {
            sale: { ...sale, signerSignatureUrl: sale.signerSignatureUrl ?? sale.user?.signatureUrl ?? null },
            shopConfig,
            dueDate,
            signerDisplayName,
            transferPrimaryAccount,
            receivedTransferAccount,
            payments: (paymentsBySaleId.get(sale.id) ?? []).map((payment) => ({
              accountName: payment.cashBankAccount.name,
              accountType: payment.cashBankAccount.type,
              bankName: payment.cashBankAccount.bankName,
              accountNo: payment.cashBankAccount.accountNo,
              amount: Number(payment.amount),
            })),
            promptPayQrDataUrl,
            qrAmount: transferDocumentState.qrAmount,
            verify,
          };

          // เรียงแบบสลับคู่ต่อบิล: A-ต้นฉบับ, A-สำเนา, B-ต้นฉบับ, B-สำเนา
          // ใบแรกสุดของทั้งชุดได้ class `print-slip-lead` เพื่อไม่ให้ขึ้นหน้าใหม่ก่อนหน้าแรก
          return (
            <Fragment key={sale.id}>
              <SharedSalesDeliveryPrintDocument
                {...slipProps}
                copyLabel={PRINT_COPY_LABEL_ORIGINAL}
                rootClassName={index === 0 ? `${DELIVERY_SLIP_CLASS} print-slip-lead` : DELIVERY_SLIP_CLASS}
              />
              <SharedSalesDeliveryPrintDocument
                {...slipProps}
                copyLabel={PRINT_COPY_LABEL_DUPLICATE}
                rootClassName={`${DELIVERY_SLIP_CLASS} ${PRINT_SLIP_COPY_CLASS}`}
              />
            </Fragment>
          );
        }),
      )}
    </>
  );
};

export default DeliveryPrintPage;
