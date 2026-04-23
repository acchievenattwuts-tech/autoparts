export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { notFound } from "next/navigation";

import SharedSalesDeliveryPrintDocument from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import AutoPrint from "@/components/shared/AutoPrint";
import PrintButton from "./PrintButton";
import { db } from "@/lib/db";
import { buildPromptPayQrDataUrl, getTransferDocumentState } from "@/lib/payment-qr";
import { requirePermission } from "@/lib/require-auth";
import { defaultSiteConfig, type SiteConfig } from "@/lib/site-config";

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
    vatType: map["vat_type"] ?? defaultSiteConfig.vatType,
    vatRate: Number(map["vat_rate"] ?? defaultSiteConfig.vatRate),
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

  const [sales, siteContents, primaryTransferAccount] = await db.$transaction([
    db.sale.findMany({
      where: { id: { in: idList }, fulfillmentType: "DELIVERY", status: "ACTIVE" },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        customerName: true,
        customerPhone: true,
        shippingAddress: true,
        totalAmount: true,
        discount: true,
        netAmount: true,
        shippingFee: true,
        paymentType: true,
        paymentMethod: true,
        creditTerm: true,
        note: true,
        signerName: true,
        signerSignatureUrl: true,
        cashBankAccount: { select: { name: true, bankName: true, accountNo: true } },
        user: { select: { name: true } },
        customer: { select: { name: true, phone: true, address: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            salePrice: true,
            totalAmount: true,
            lotItems: { select: { lotNo: true, qty: true } },
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
            page-break-after: always;
            width: 100%;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }
          .slip:last-child { page-break-after: avoid; }
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
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b bg-white p-4">
        <span className="font-medium text-gray-700">ใบส่งของ {sales.length} ใบ</span>
        <PrintButton />
      </div>

      <Suspense fallback={null}>
        <AutoPrint />
      </Suspense>

      {await Promise.all(
        sales.map(async (sale) => {
          const transferDocumentState = getTransferDocumentState({
            paymentType: sale.paymentType,
            netAmount: Number(sale.netAmount),
            primaryTransferAccount,
          });
          const dueDate = new Date(new Date(sale.saleDate).getTime() + (sale.creditTerm ?? 0) * 24 * 60 * 60 * 1000);
          const signerDisplayName = sale.signerName ?? sale.user?.name ?? "-";
          const receivedTransferAccount =
            sale.paymentType === "CASH_SALE" && sale.paymentMethod === "TRANSFER"
              ? sale.cashBankAccount ?? primaryTransferAccount
              : null;
          const transferPrimaryAccount = transferDocumentState.shouldShowTransferSection ? primaryTransferAccount : null;
          const promptPayQrDataUrl = transferDocumentState.shouldGenerateQr
            ? await buildPromptPayQrDataUrl(primaryTransferAccount?.promptPayId, transferDocumentState.qrAmount)
            : null;

          return (
            <SharedSalesDeliveryPrintDocument
              key={sale.id}
              sale={sale}
              shopConfig={shopConfig}
              dueDate={dueDate}
              signerDisplayName={signerDisplayName}
              transferPrimaryAccount={transferPrimaryAccount}
              receivedTransferAccount={receivedTransferAccount}
              promptPayQrDataUrl={promptPayQrDataUrl}
              qrAmount={transferDocumentState.qrAmount}
              rootClassName="slip mx-auto bg-white p-8 text-[13px] leading-snug md:flex md:min-h-[100vh] md:flex-col"
            />
          );
        }),
      )}
    </>
  );
};

export default DeliveryPrintPage;
