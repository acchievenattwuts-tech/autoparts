import { notFound } from "next/navigation";

import SharedReceiptSettlementPrintDocument from "@/app/admin/_components/SharedReceiptSettlementPrintDocument";
import SharedSalesDeliveryPrintDocument from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import ExternalPrintShell, { EXTERNAL_A4_PRINT_ROOT_CLASS } from "@/components/liff/ExternalPrintShell";
import { db } from "@/lib/db";
import { PaymentMethod, SalePaymentType } from "@/lib/generated/prisma";
import { buildPromptPayQrDataUrl, getTransferDocumentState } from "@/lib/payment-qr";
import { getPublicSiteConfig } from "@/lib/site-config";
import { addThailandDays } from "@/lib/th-date";
import { buildPrintDocumentVerifyBadge, verifyLiffPrintDocumentToken } from "@/lib/verify-token";

export const dynamic = "force-dynamic";

export default async function ExternalLiffOrderReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ printToken?: string; receiptId?: string }>;
}) {
  const [{ id }, { printToken, receiptId }, shopConfig, primaryTransferAccount] = await Promise.all([
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
  const tokenAccess = verifyLiffPrintDocumentToken({ token: printToken, kind: "receipt", saleId: id, receiptId });
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
          unitListPrice: true,
          lineDiscount: true,
          totalAmount: true,
          showQty: true,
          showUnitName: true,
          showPricePerUnit: true,
          unitScale: true,
          moreDetail: true,
          warrantyDays: true,
          lotItems: { select: { lotNo: true, qty: true } },
          product: { select: { code: true, name: true, reportUnitName: true } },
        },
      },
      receipts: {
        where: {
          receipt: {
            status: "ACTIVE",
            ...(receiptId ? { id: receiptId } : {}),
          },
        },
        select: {
          receipt: {
            select: {
              id: true,
              receiptDate: true,
            },
          },
        },
        orderBy: { receipt: { receiptDate: "desc" } },
        take: 1,
      },
    },
  });

  if (!sale) notFound();

  if (sale.paymentType === SalePaymentType.CASH_SALE) {
    const salePayments = await db.documentPayment.findMany({
      where: { docType: "SALE", docId: sale.id },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: {
        amount: true,
        cashBankAccount: { select: { name: true, type: true, bankName: true, accountNo: true } },
      },
    });
    const dueDate = addThailandDays(sale.saleDate, sale.creditTerm ?? 0);
    const signerDisplayName = sale.signerName ?? sale.user?.name ?? "-";
    const transferDocumentState = getTransferDocumentState({
      paymentType: sale.paymentType,
      netAmount: Number(sale.netAmount),
      primaryTransferAccount,
    });
    const receivedTransferAccount =
      sale.paymentMethod === "TRANSFER" ? sale.cashBankAccount ?? primaryTransferAccount : null;
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
        buttonLabel="บันทึกใบเสร็จ PDF"
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
          transferPrimaryAccount={null}
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
          rootClassName={EXTERNAL_A4_PRINT_ROOT_CLASS}
        />
      </ExternalPrintShell>
    );
  }

  const targetReceiptId = sale.receipts[0]?.receipt.id;
  if (!targetReceiptId) notFound();

  const receipt = await db.receipt.findFirst({
    where: {
      id: targetReceiptId,
      status: "ACTIVE",
      items: {
        some: {
          sale: {
            id: sale.id,
            customerId: tokenAccess.customerId,
          },
        },
      },
    },
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
  });

  if (!receipt) notFound();

  const receiptPayments = await db.documentPayment.findMany({
    where: { docType: "RECEIPT", docId: receipt.id },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    select: {
      amount: true,
      cashBankAccount: { select: { name: true, type: true, bankName: true, accountNo: true } },
    },
  });

  const signerDisplayName = receipt.signerName ?? receipt.user?.name ?? "-";
  const receivedTransferAccount =
    receipt.paymentMethod === PaymentMethod.TRANSFER
      ? receipt.cashBankAccount ?? primaryTransferAccount
      : null;
  const verify = await buildPrintDocumentVerifyBadge({
    type: "receipt",
    docNo: receipt.receiptNo,
    variant: "LIFF_COPY",
  });

  return (
    <ExternalPrintShell
      buttonLabel="บันทึกใบเสร็จ PDF"
      preloadImageUrls={[shopConfig.shopLogoUrl, receipt.signerSignatureUrl ?? receipt.user?.signatureUrl ?? null]}
    >
      <SharedReceiptSettlementPrintDocument
        receipt={{
          ...receipt,
          customerName: receipt.customer?.name ?? receipt.customerName,
          signerSignatureUrl: receipt.signerSignatureUrl ?? receipt.user?.signatureUrl ?? null,
        }}
        shopConfig={{
          shopName: shopConfig.shopName,
          shopAddress: shopConfig.shopAddress,
          shopPhone: shopConfig.shopPhone,
          shopLogoUrl: shopConfig.shopLogoUrl,
          shopWebsiteUrl: shopConfig.shopWebsiteUrl,
          shopLineId: shopConfig.shopLineId,
          printNoticeText: shopConfig.printNoticeText,
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
        rootClassName={EXTERNAL_A4_PRINT_ROOT_CLASS}
      />
    </ExternalPrintShell>
  );
}
