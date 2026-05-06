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
import { buildPrintDocumentVerifyBadge } from "@/lib/verify-token";

export const dynamic = "force-dynamic";

export default async function LiffOrderReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ receiptId?: string }>;
}) {
  const [{ id }, { receiptId }, customer, shopConfig, primaryTransferAccount] = await Promise.all([
    params,
    searchParams,
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
    const requestContext = await getRequestContext();
    void safeWriteAuditLog({
      ...requestContext,
      action: AuditAction.CUSTOMER_VIEW_RECEIPT_PDF,
      entityType: "Sale",
      entityId: sale.id,
      entityRef: sale.saleNo,
      meta: {
        customerId: customer.id,
        lineLinkedAt: customer.lineLinkedAt,
        receiptSource: "cash_sale",
        source: "LIFF",
      },
    });

    return (
      <LiffPrintShell backHref={`/liff/orders/${sale.id}`} buttonLabel="บันทึกใบเสร็จ PDF">
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
            customerId: customer.id,
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
  const requestContext = await getRequestContext();
  void safeWriteAuditLog({
    ...requestContext,
    action: AuditAction.CUSTOMER_VIEW_RECEIPT_PDF,
    entityType: "Receipt",
    entityId: receipt.id,
    entityRef: receipt.receiptNo,
    meta: {
      customerId: customer.id,
      lineLinkedAt: customer.lineLinkedAt,
      saleId: sale.id,
      saleNo: sale.saleNo,
      source: "LIFF",
    },
  });

  return (
    <LiffPrintShell backHref={`/liff/orders/${sale.id}`} buttonLabel="บันทึกใบเสร็จ PDF">
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
      />
    </LiffPrintShell>
  );
}

function LiffPrintShell({
  backHref,
  buttonLabel,
  children,
}: {
  backHref: string;
  buttonLabel: string;
  children: React.ReactNode;
}) {
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
          <Link href={backHref} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-800">
            <ChevronLeft size={16} />
            กลับ
          </Link>
          <PrintToPdfButton label={buttonLabel} />
        </div>
        <p className="mx-auto mt-2 max-w-[900px] text-right text-[11px] text-slate-500">
          หากเปิดใน LINE ระบบจะพาไปเบราว์เซอร์ภายนอกก่อนบันทึก/พิมพ์ PDF
        </p>
      </div>

      <div className="overflow-x-auto bg-gradient-to-b from-sky-50 to-white px-4 py-4">{children}</div>
    </>
  );
}
