import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";

import SharedReceiptSettlementPrintDocument from "@/app/admin/_components/SharedReceiptSettlementPrintDocument";
import SharedSalesDeliveryPrintDocument from "@/app/admin/_components/SharedSalesDeliveryPrintDocument";
import PrintToPdfButton from "@/components/liff/PrintToPdfButton";
import { getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction, PaymentMethod, SalePaymentType } from "@/lib/generated/prisma";
import { requireLiffCustomer } from "@/lib/liff-data";
import { buildPromptPayQrDataUrl, getTransferDocumentState } from "@/lib/payment-qr";
import { getPublicSiteConfig } from "@/lib/site-config";
import {
  buildLiffPrintDocumentUrl,
  buildPrintDocumentVerifyBadge,
  verifyLiffPrintDocumentToken,
} from "@/lib/verify-token";

export const dynamic = "force-dynamic";

const LIFF_A4_PRINT_ROOT_CLASS =
  "mx-auto flex h-[297mm] w-[210mm] max-w-none flex-col overflow-hidden bg-white p-[8mm] text-[11px] leading-tight text-gray-900";

export default async function LiffOrderReceiptPage({
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
  const liffCustomer = tokenAccess ? null : await requireLiffCustomer();
  const customerId = tokenAccess?.customerId ?? liffCustomer!.id;

  const sale = await db.sale.findFirst({
    where: {
      id,
      customerId,
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
    const dueDate = new Date(new Date(sale.saleDate).getTime() + (sale.creditTerm ?? 0) * 24 * 60 * 60 * 1000);
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
    const externalPrintUrl = buildLiffPrintDocumentUrl({
      kind: "receipt",
      saleId: sale.id,
      customerId,
    });
    if (!tokenAccess && liffCustomer) {
      const requestContext = await getRequestContext();
      void safeWriteAuditLog({
        ...requestContext,
        action: AuditAction.CUSTOMER_VIEW_RECEIPT_PDF,
        entityType: "Sale",
        entityId: sale.id,
        entityRef: sale.saleNo,
        meta: {
          customerId,
          lineLinkedAt: liffCustomer.lineLinkedAt,
          receiptSource: "cash_sale",
          source: "LIFF",
        },
      });
    }

    return (
      <LiffPrintShell
        backHref={`/liff/orders/${sale.id}`}
        buttonLabel="บันทึกใบเสร็จ PDF"
        externalUrl={externalPrintUrl}
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
          promptPayQrDataUrl={promptPayQrDataUrl}
          qrAmount={transferDocumentState.qrAmount}
          verify={verify}
          rootId="receipt"
          rootClassName={LIFF_A4_PRINT_ROOT_CLASS}
        />
      </LiffPrintShell>
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
            customerId,
          },
        },
      },
    },
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
  });

  if (!receipt) notFound();

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
  const externalPrintUrl = buildLiffPrintDocumentUrl({
    kind: "receipt",
    saleId: sale.id,
    customerId,
    receiptId: receipt.id,
  });
  if (!tokenAccess && liffCustomer) {
    const requestContext = await getRequestContext();
    void safeWriteAuditLog({
      ...requestContext,
      action: AuditAction.CUSTOMER_VIEW_RECEIPT_PDF,
      entityType: "Receipt",
      entityId: receipt.id,
      entityRef: receipt.receiptNo,
      meta: {
        customerId,
        lineLinkedAt: liffCustomer.lineLinkedAt,
        saleId: sale.id,
        saleNo: sale.saleNo,
        source: "LIFF",
      },
    });
  }

  return (
    <LiffPrintShell
      backHref={`/liff/orders/${sale.id}`}
      buttonLabel="บันทึกใบเสร็จ PDF"
      externalUrl={externalPrintUrl}
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
        verify={verify}
        rootId="receipt"
        rootClassName={LIFF_A4_PRINT_ROOT_CLASS}
      />
    </LiffPrintShell>
  );
}

function LiffPrintShell({
  backHref,
  buttonLabel,
  externalUrl,
  children,
}: {
  backHref: string;
  buttonLabel: string;
  externalUrl?: string | null;
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        html,
        body {
          background: #ffffff !important;
          color-scheme: only light !important;
        }
        @media print {
          body * { visibility: hidden; }
          #receipt, #receipt * { visibility: visible; }
          #receipt, #receipt * {
            color-scheme: only light !important;
            forced-color-adjust: none !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 210mm !important;
            height: 297mm !important;
            min-height: 297mm !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            display: flex;
            flex-direction: column;
            background: #ffffff !important;
            color: #111827 !important;
            box-sizing: border-box;
          }
          #receipt :is(.bg-white, .bg-white\/95, .bg-white\/90, .bg-white\/80) { background-color: #ffffff !important; }
          #receipt :is(.bg-gray-50, .hover\:bg-gray-50:hover) { background-color: #f9fafb !important; }
          #receipt :is(.bg-gray-100, .hover\:bg-gray-100:hover, .bg-gray-200, .hover\:bg-gray-200:hover) { background-color: #f3f4f6 !important; }
          #receipt :is(.text-gray-900, .text-gray-800, .text-gray-700) { color: #111827 !important; }
          #receipt :is(.text-gray-600, .text-gray-500, .text-gray-400) { color: #6b7280 !important; }
          #receipt .text-\\[\\#1e3a5f\\] { color: #1e3a5f !important; }
          .no-print { display: none !important; }
          .receipt-footer { margin-top: auto; }
        }
        @media screen {
          #receipt {
            width: 210mm;
            min-width: 210mm;
            min-height: 297mm;
            background: #ffffff !important;
            color: #111827 !important;
          }
        }
      `}</style>

      <div className="no-print sticky top-0 z-20 border-b border-blue-100 bg-white/95 px-4 py-3 shadow-sm shadow-blue-950/5 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-3">
          <Link href={backHref} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-800">
            <ChevronLeft size={16} />
            กลับ
          </Link>
          <PrintToPdfButton label={buttonLabel} externalUrl={externalUrl} />
        </div>
        <p className="mx-auto mt-2 max-w-[900px] text-right text-[11px] text-slate-500">
          หากเปิดใน LINE ระบบจะพาไปเบราว์เซอร์ภายนอกก่อนบันทึก/พิมพ์ PDF
        </p>
      </div>

      <div className="overflow-x-auto bg-white px-4 py-4 [color-scheme:light]">{children}</div>
    </>
  );
}
