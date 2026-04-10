export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { notFound } from "next/navigation";

import SalesDeliveryPrintDocument from "@/app/admin/_components/SalesDeliveryPrintDocument";
import AutoPrint from "@/components/shared/AutoPrint";
import PrintButton from "./PrintButton";
import { db } from "@/lib/db";
import { buildPromptPayQrDataUrl, getPrimaryTransferAccount, getTransferDocumentState } from "@/lib/payment-qr";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";

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

  const [sales, shopConfig, primaryTransferAccount] = await Promise.all([
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
    getSiteConfig(),
    getPrimaryTransferAccount(),
  ]);

  if (sales.length === 0) notFound();

  return (
    <>
      <style>{`
        @page { margin: 0; }
        @media print {
          .no-print { display: none !important; }
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
          body { background: #f3f4f6; }
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
            <SalesDeliveryPrintDocument
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
