export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { formatDateOnlyForInput } from "@/lib/th-date";
import {
  buildMutationBlockMessage,
  buildMutationBlockReferenceLinks,
  checkDocumentMutation,
} from "@/lib/document-mutation-guard";
import DocumentMutationBlockedNotice from "@/components/shared/DocumentMutationBlockedNotice";
import CreditNoteForm from "../../new/CreditNoteForm";
import { CNRefundMethod, CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";
import { getCreditNoteProductOptionsByIds, getTransactionCustomers } from "@/lib/transaction-options";

const EditCreditNotePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("credit_notes.update");

  const { id } = await params;

  const cn = await db.creditNote.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        include: {
          product: {
            select: {
              units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
            },
          },
          lotItems: { orderBy: { id: "asc" }, select: { lotNo: true, qty: true, isReturnLot: true } },
        },
      },
    },
  });

  if (!cn) notFound();
  if (cn.status === "CANCELLED") redirect(`/admin/credit-notes/${id}`);

  const cnPayments = await db.documentPayment.findMany({
    where: { docType: "CN_SALE", docId: id },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    select: { cashBankAccountId: true, amount: true },
  });

  const mutationBlock = await checkDocumentMutation("CreditNote", id, "update");
  const mutationBlockMessage = buildMutationBlockMessage(mutationBlock);
  const mutationBlockReferences = buildMutationBlockReferenceLinks(mutationBlock);

  const [products, customers, config, cashBankAccounts] = await Promise.all([
    getCreditNoteProductOptionsByIds(cn.items.map((item) => item.productId).filter((productId): productId is string => !!productId)),
    getTransactionCustomers([cn.customerId]),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  const initialSales = cn.customerId
    ? await db.sale.findMany({
        where:   { customerId: cn.customerId, status: "ACTIVE" },
        orderBy: { saleDate: "desc" },
        take:    200,
        select:  { id: true, saleNo: true, customerName: true, saleDate: true },
      })
    : [];

  const initialItems = cn.items
    .filter((item) => item.productId !== null)
    .map((item) => {
      const productOption = products.find((product) => product.id === item.productId);
      const unitName = productOption?.saleUnitName || item.product?.units.find((u) => u.isBase)?.name || "";
      const unit = item.product?.units.find((u) => u.name === unitName);
      const scale = Number(item.unitScale ?? unit?.scale ?? 1) || 1;
      const displayUnitName = item.showUnitName ?? unitName;
      const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.qty) / scale;
      const displaySalePrice =
        item.showPricePerUnit != null
          ? Number(item.showPricePerUnit)
          : Number(item.unitPrice);
      return {
        productId: item.productId ?? "",
        unitName: displayUnitName,
        qty:       displayQty,
        salePrice: displaySalePrice,
        moreDetail: item.moreDetail ?? "",
        lotItems: item.lotItems.map((lot) => ({
          lotNo: lot.isReturnLot ? lot.lotNo.replace(/^RET-/, "") : lot.lotNo,
          qty: Number(lot.qty) / scale,
          unitCost: displaySalePrice,
          mfgDate: "",
          expDate: "",
          isReturnLot: lot.isReturnLot,
        })),
      };
    });

  const initialData = {
    id,
        cnDate:         formatDateOnlyForInput(cn.cnDate),
    customerId:     cn.customerId ?? "",
    customerName:   cn.customerName ?? "",
    saleId:         cn.saleId ?? "",
    type:           cn.type as CreditNoteType,
    settlementType: cn.settlementType as CNSettlementType,
    refundMethod:   (cn.refundMethod ?? "CASH") as CNRefundMethod,
    cashBankAccountId: cn.cashBankAccountId ?? "",
    payments: cnPayments.map((row) => ({
      cashBankAccountId: row.cashBankAccountId,
      amount: Number(row.amount),
    })),
    note:           cn.note ?? "",
    vatType:        cn.vatType,
    vatRate:        Number(cn.vatRate),
    items:          initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <NavLink href={`/admin/credit-notes/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> {cn.cnNo}
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">แก้ไขใบลดหนี้</h1>
      {mutationBlockMessage && (
        <div className="mb-6">
          <DocumentMutationBlockedNotice
            message={mutationBlockMessage}
            references={mutationBlockReferences}
          />
        </div>
      )}
      <CreditNoteForm
        products={products}
        customers={customers}
        cashBankAccounts={cashBankAccounts}
        initialSales={initialSales}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
        submitLocked={!!mutationBlockMessage}
      />
    </div>
  );
};

export default EditCreditNotePage;
