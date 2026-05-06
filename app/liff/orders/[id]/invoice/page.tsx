import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";

import SharedSalesDeliveryPrintDocument from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import PrintToPdfButton from "@/components/liff/PrintToPdfButton";
import { getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requireLiffCustomer } from "@/lib/liff-data";
import { buildPromptPayQrDataUrl, getTransferDocumentState } from "@/lib/payment-qr";
import { getPublicSiteConfig } from "@/lib/site-config";
import { buildPrintDocumentVerifyBadge } from "@/lib/verify-token";

export const dynamic = "force-dynamic";

export default async function LiffOrderInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, customer, shopConfig, primaryTransferAccount] = await Promise.all([
    params,
    requireLiffCustomer(),
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

  const sale = await db.sale.findFirst({
    where: {
      id,
      customerId: customer.id,
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
        select: {
          id: true,
          quantity: true,
          salePrice: true,
          totalAmount: true,
          lotItems: { select: { lotNo: true, qty: true } },
          product: { select: { code: true, name: true, reportUnitName: true } },
        },
      },
    },
  });

  if (!sale) notFound();

  const dueDate = new Date(new Date(sale.saleDate).getTime() + (sale.creditTerm ?? 0) * 24 * 60 * 60 * 1000);
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
  const requestContext = await getRequestContext();
  void safeWriteAuditLog({
    ...requestContext,
    action: AuditAction.CUSTOMER_VIEW_INVOICE_PDF,
    entityType: "Sale",
    entityId: sale.id,
    entityRef: sale.saleNo,
    meta: {
      customerId: customer.id,
      lineLinkedAt: customer.lineLinkedAt,
      source: "LIFF",
    },
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
        @media screen {
          #receipt {
            min-width: 900px;
          }
        }
      `}</style>

      <div className="no-print sticky top-0 z-20 border-b border-blue-100 bg-white/95 px-4 py-3 shadow-sm shadow-blue-950/5 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-3">
          <Link href={`/liff/orders/${sale.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-800">
            <ChevronLeft size={16} />
            กลับ
          </Link>
          <PrintToPdfButton label={sale.paymentType === "CREDIT_SALE" ? "บันทึกใบแจ้งหนี้ PDF" : "บันทึกใบเสร็จ PDF"} />
        </div>
      </div>

      <div className="overflow-x-auto bg-gradient-to-b from-sky-50 to-white px-4 py-4">
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
        />
      </div>
    </>
  );
}
