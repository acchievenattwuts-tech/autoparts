export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import ReceiptForm from "../../new/ReceiptForm";
import type { CreditSaleItem } from "../../actions";

const EditReceiptPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  const [receipt, customers] = await Promise.all([
    db.receipt.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            saleId:     true,
            paidAmount: true,
            sale: {
              select: {
                saleNo:      true,
                saleDate:    true,
                netAmount:   true,
                amountRemain: true,
              },
            },
          },
        },
      },
    }),
    db.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);

  if (!receipt) notFound();
  if (receipt.status === "CANCELLED") redirect(`/admin/receipts/${id}`);

  // Build pre-loaded sales list for the edit form:
  // For receipt's own sales: outstanding = current amountRemain + this receipt's paidAmount
  // This reconstructs what the outstanding was before this receipt was applied.
  const receiptSaleIds = new Set(receipt.items.map((i) => i.saleId).filter(Boolean));

  const receiptSalesAsCreditItems: CreditSaleItem[] = receipt.items
    .filter((item) => item.saleId !== null && item.sale !== null)
    .map((item) => {
      const sale       = item.sale!;
      const paidHere   = Number(item.paidAmount);
      const curRemain  = Number(sale.amountRemain);
      // outstanding for edit = current remaining + what this receipt paid
      const outstanding = curRemain + paidHere;
      // paidAmount on the sale = netAmount - outstanding
      const paidAlready = Math.max(0, Number(sale.netAmount) - outstanding);
      return {
        id:          item.saleId!,
        saleNo:      sale.saleNo,
        saleDate:    sale.saleDate.toISOString(),
        netAmount:   Number(sale.netAmount),
        paidAmount:  paidAlready,
        outstanding,
      };
    });

  // Also load other outstanding credit sales for this customer (not in this receipt)
  let otherSales: CreditSaleItem[] = [];
  if (receipt.customerId) {
    const otherRawSales = await db.sale.findMany({
      where: {
        customerId:  receipt.customerId,
        paymentType: "CREDIT_SALE",
        status:      "ACTIVE",
        id:          { notIn: [...receiptSaleIds].filter((s): s is string => s !== null) },
        amountRemain: { gt: 0 },
      },
      orderBy: { saleDate: "asc" },
      select: {
        id:           true,
        saleNo:       true,
        saleDate:     true,
        netAmount:    true,
        amountRemain: true,
        receipts: {
          where:  { receipt: { status: "ACTIVE" } },
          select: { paidAmount: true },
        },
      },
    });
    otherSales = otherRawSales.map((s) => {
      const paid = s.receipts.reduce((sum, r) => sum + Number(r.paidAmount), 0);
      return {
        id:          s.id,
        saleNo:      s.saleNo,
        saleDate:    s.saleDate.toISOString(),
        netAmount:   Number(s.netAmount),
        paidAmount:  paid,
        outstanding: Number(s.amountRemain),
      };
    });
  }

  const initialCreditSales: CreditSaleItem[] = [...receiptSalesAsCreditItems, ...otherSales];

  const initialData = {
    id,
    customerId:    receipt.customerId ?? "",
    customerName:  receipt.customerName ?? "",
    receiptDate:   receipt.receiptDate.toISOString().slice(0, 10),
    paymentMethod: receipt.paymentMethod as "CASH" | "TRANSFER",
    note:          receipt.note ?? "",
    items: receipt.items
      .filter((item) => item.saleId !== null && item.sale !== null)
      .map((item) => {
        const sale       = item.sale!;
        const paidHere   = Number(item.paidAmount);
        const curRemain  = Number(sale.amountRemain);
        const outstanding = curRemain + paidHere;
        return {
          saleId:      item.saleId!,
          saleNo:      sale.saleNo,
          outstanding,
          paidAmount:  paidHere,
        };
      }),
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/receipts/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> {receipt.receiptNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขใบเสร็จรับเงิน</h1>
      <ReceiptForm
        customers={customers}
        initialData={initialData}
        initialCreditSales={initialCreditSales}
      />
    </div>
  );
};

export default EditReceiptPage;
