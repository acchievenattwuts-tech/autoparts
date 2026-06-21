import { notFound } from "next/navigation";

import SharedSalesDeliveryPrintDocument from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import ExternalPrintShell, { EXTERNAL_A4_PRINT_ROOT_CLASS } from "@/components/liff/ExternalPrintShell";
import { db } from "@/lib/db";
import { buildPromptPayQrDataUrl, getTransferDocumentState } from "@/lib/payment-qr";
import { getPublicSiteConfig } from "@/lib/site-config";
import { addThailandDays } from "@/lib/th-date";
import { buildPrintDocumentVerifyBadge, verifyLiffPrintDocumentToken } from "@/lib/verify-token";

export const dynamic = "force-dynamic";

export default async function ExternalLiffOrderInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ printToken?: string }>;
}) {
  const [{ id }, { printToken }, shopConfig, primaryTransferAccount] = await Promise.all([
    params,
    searchParams,
    getPublicSiteConfig(),
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
  const tokenAccess = verifyLiffPrintDocumentToken({ token: printToken, kind: "invoice", saleId: id });
  if (!tokenAccess) notFound();

  const sale = await db.sale.findFirst({
    where: {
      id,
      customerId: tokenAccess.customerId,
      status: "ACTIVE",
    },
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
          totalAmount: true,
          showQty: true,
          showUnitName: true,
          showPricePerUnit: true,
          unitScale: true,
          moreDetail: true,
          lotItems: { select: { lotNo: true, qty: true } },
          product: { select: { code: true, name: true, reportUnitName: true } },
        },
      },
    },
  });

  if (!sale) notFound();

  const dueDate = addThailandDays(sale.saleDate, sale.creditTerm ?? 0);
  const signerDisplayName = sale.signerName ?? sale.user?.name ?? "-";
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
    variant: "LIFF_COPY",
  });

  return (
    <ExternalPrintShell
      buttonLabel={sale.paymentType === "CREDIT_SALE" ? "บันทึกใบแจ้งหนี้ PDF" : "บันทึกใบเสร็จ PDF"}
      preloadImageUrls={[shopConfig.shopLogoUrl, sale.signerSignatureUrl ?? sale.user?.signatureUrl ?? null]}
    >
      <SharedSalesDeliveryPrintDocument
        sale={{
          ...sale,
          signerSignatureUrl: sale.signerSignatureUrl ?? sale.user?.signatureUrl ?? null,
        }}
        shopConfig={shopConfig}
        dueDate={dueDate}
        signerDisplayName={signerDisplayName}
        transferPrimaryAccount={transferPrimaryAccount}
        receivedTransferAccount={receivedTransferAccount}
        promptPayQrDataUrl={promptPayQrDataUrl}
        qrAmount={transferDocumentState.qrAmount}
        verify={verify}
        rootId="receipt"
        rootClassName={EXTERNAL_A4_PRINT_ROOT_CLASS}
      />
    </ExternalPrintShell>
  );
}
