export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import ReceiptForm from "../../new/ReceiptForm";
import type { CreditSaleItem } from "../../actions";

const EditReceiptPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("receipts.update");

  const { id } = await params;

  const [receipt, customers] = await Promise.all([
    db.receipt.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            saleId:     true,
            cnId:       true,
            paidAmount: true,
            sale: {
              select: {
                saleNo:       true,
                saleDate:     true,
                netAmount:    true,
                amountRemain: true,
              },
            },
            creditNote: {
              select: {
                cnNo:         true,
                cnDate:       true,
                totalAmount:  true,
                amountRemain: true,
              },
            },
          },
        },
      },
    }),
    db.customer.findMany({
      where:   { isActive: true },
      orderBy: { name: "asc" },
      select:  { id: true, name: true, code: true },
    }).then((rows) => rows.map((c) => ({ ...c, amountRemain: 0 }))),
  ]);

  if (!receipt) notFound();
  if (receipt.status === "CANCELLED") redirect(`/admin/receipts/${id}`);

  const receiptSaleIds = new Set(receipt.items.map((i) => i.saleId).filter(Boolean));
  const receiptCnIds   = new Set(receipt.items.map((i) => i.cnId).filter(Boolean));

  // Reconstruct Sale items: outstanding = current amountRemain + what this receipt paid
  const receiptSaleItems: CreditSaleItem[] = receipt.items
    .filter((item) => item.saleId !== null && item.sale !== null)
    .map((item) => {
      const sale        = item.sale!;
      const paidHere    = Number(item.paidAmount);
      const curRemain   = Number(sale.amountRemain);
      const outstanding = curRemain + paidHere;
      const paidAlready = Math.max(0, Number(sale.netAmount) - outstanding);
      return {
        id:          item.saleId!,
        saleNo:      sale.saleNo,
        saleDate:    sale.saleDate.toISOString(),
        netAmount:   Number(sale.netAmount),
        paidAmount:  paidAlready,
        outstanding,
        type:        "SALE" as const,
      };
    });

  // Reconstruct CN items: outstanding = current amountRemain + what this receipt applied
  const receiptCNItems: CreditSaleItem[] = receipt.items
    .filter((item) => item.cnId !== null && item.creditNote !== null)
    .map((item) => {
      const cn          = item.creditNote!;
      const appliedHere = Number(item.paidAmount);
      const curRemain   = Number(cn.amountRemain);
      const outstanding = curRemain + appliedHere;
      const usedAlready = Math.max(0, Number(cn.totalAmount) - outstanding);
      return {
        id:          item.cnId!,
        saleNo:      cn.cnNo,
        saleDate:    cn.cnDate.toISOString(),
        netAmount:   Number(cn.totalAmount),
        paidAmount:  usedAlready,
        outstanding,
        type:        "CN" as const,
      };
    });

  // Load other outstanding credit sales for this customer (not in this receipt)
  let otherSaleItems: CreditSaleItem[] = [];
  let otherCNItems:   CreditSaleItem[] = [];
  if (receipt.customerId) {
    const [otherRawSales, otherRawCNs] = await Promise.all([
      db.sale.findMany({
        where: {
          customerId:   receipt.customerId,
          paymentType:  "CREDIT_SALE",
          status:       "ACTIVE",
          id:           { notIn: [...receiptSaleIds].filter((s): s is string => s !== null) },
          amountRemain: { gt: 0 },
        },
        orderBy: { saleDate: "asc" },
        select: {
          id:           true,
          saleNo:       true,
          saleDate:     true,
          netAmount:    true,
          amountRemain: true,
        },
      }),
      db.creditNote.findMany({
        where: {
          customerId:     receipt.customerId,
          settlementType: "CREDIT_DEBT",
          status:         "ACTIVE",
          id:             { notIn: [...receiptCnIds].filter((s): s is string => s !== null) },
          amountRemain:   { gt: 0 },
        },
        orderBy: { cnDate: "asc" },
        select: {
          id:           true,
          cnNo:         true,
          cnDate:       true,
          totalAmount:  true,
          amountRemain: true,
        },
      }),
    ]);

    otherSaleItems = otherRawSales.map((s) => ({
      id:          s.id,
      saleNo:      s.saleNo,
      saleDate:    s.saleDate.toISOString(),
      netAmount:   Number(s.netAmount),
      paidAmount:  Number(s.netAmount) - Number(s.amountRemain),
      outstanding: Number(s.amountRemain),
      type:        "SALE" as const,
    }));

    otherCNItems = otherRawCNs.map((cn) => ({
      id:          cn.id,
      saleNo:      cn.cnNo,
      saleDate:    cn.cnDate.toISOString(),
      netAmount:   Number(cn.totalAmount),
      paidAmount:  Number(cn.totalAmount) - Number(cn.amountRemain),
      outstanding: Number(cn.amountRemain),
      type:        "CN" as const,
    }));
  }

  const initialCreditSales: CreditSaleItem[] = [
    ...receiptSaleItems,
    ...otherSaleItems,
    ...receiptCNItems,
    ...otherCNItems,
  ];

  const initialData = {
    id,
    customerId:    receipt.customerId ?? "",
    customerName:  receipt.customerName ?? "",
    receiptDate:   receipt.receiptDate.toISOString().slice(0, 10),
    paymentMethod: receipt.paymentMethod as "CASH" | "TRANSFER",
    note:          receipt.note ?? "",
    items: [
      // Sale items
      ...receipt.items
        .filter((item) => item.saleId !== null && item.sale !== null)
        .map((item) => {
          const sale        = item.sale!;
          const paidHere    = Number(item.paidAmount);
          const curRemain   = Number(sale.amountRemain);
          const outstanding = curRemain + paidHere;
          return {
            saleId:      item.saleId!,
            cnId:        undefined,
            saleNo:      sale.saleNo,
            outstanding,
            paidAmount:  paidHere,
            isCN:        false,
          };
        }),
      // CN items
      ...receipt.items
        .filter((item) => item.cnId !== null && item.creditNote !== null)
        .map((item) => {
          const cn          = item.creditNote!;
          const appliedHere = Number(item.paidAmount);
          const curRemain   = Number(cn.amountRemain);
          const outstanding = curRemain + appliedHere;
          return {
            saleId:      undefined,
            cnId:        item.cnId!,
            saleNo:      cn.cnNo,
            outstanding,
            paidAmount:  appliedHere,
            isCN:        true,
          };
        }),
    ],
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
