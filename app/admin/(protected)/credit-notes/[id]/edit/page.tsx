export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import CreditNoteForm from "../../new/CreditNoteForm";
import { CNRefundMethod, CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";

const EditCreditNotePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("credit_notes.update");

  const { id } = await params;

  const cn = await db.creditNote.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            select: {
              units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
            },
          },
          lotItems: { select: { lotNo: true, qty: true, isReturnLot: true } },
        },
      },
    },
  });

  if (!cn) notFound();
  if (cn.status === "CANCELLED") redirect(`/admin/credit-notes/${id}`);

  const currentProductIds = [
    ...new Set(cn.items.map((item) => item.productId).filter((productId): productId is string => !!productId)),
  ];

  const [rawProducts, config] = await Promise.all([
    currentProductIds.length === 0
      ? Promise.resolve([])
      : db.product.findMany({
          where: { id: { in: currentProductIds } },
          select: {
            id: true, code: true, name: true, description: true,
            salePrice: true, saleUnitName: true,
            isLotControl: true,
            category: { select: { name: true } },
            brand:    { select: { name: true } },
            aliases:  { select: { alias: true } },
            units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
          },
        }),
    getSiteConfig(),
  ]);

  const initialSales = cn.customerId
    ? await db.sale.findMany({
        where:   { customerId: cn.customerId, status: "ACTIVE" },
        orderBy: { saleDate: "desc" },
        take:    200,
        select:  { id: true, saleNo: true, customerName: true, saleDate: true },
      })
    : [];

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    salePrice: Number(p.salePrice), saleUnitName: p.saleUnitName ?? "",
    isLotControl: p.isLotControl,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  const initialItems = cn.items
    .filter((item) => item.productId !== null)
    .map((item) => {
      const baseUnit = item.product?.units.find((u) => u.isBase) ?? item.product?.units[0];
      return {
        productId: item.productId ?? "",
        unitName:  baseUnit?.name ?? "",
        qty:       Number(item.qty),       // stored in base units
        salePrice: Number(item.unitPrice), // stored per original display unit
        lotItems: item.lotItems.map((lot) => ({
          lotNo: lot.isReturnLot ? lot.lotNo.replace(/^RET-/, "") : lot.lotNo,
          qty: Number(lot.qty),
          unitCost: Number(item.unitPrice),
          mfgDate: "",
          expDate: "",
          isReturnLot: lot.isReturnLot,
        })),
      };
    });

  const initialData = {
    id,
    cnDate:         cn.cnDate.toISOString().slice(0, 10),
    customerId:     cn.customerId ?? "",
    customerName:   cn.customerName ?? "",
    saleId:         cn.saleId ?? "",
    type:           cn.type as CreditNoteType,
    settlementType: cn.settlementType as CNSettlementType,
    refundMethod:   (cn.refundMethod ?? "CASH") as CNRefundMethod,
    note:           cn.note ?? "",
    vatType:        cn.vatType,
    vatRate:        Number(cn.vatRate),
    items:          initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/credit-notes/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> {cn.cnNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขใบลดหนี้</h1>
      <CreditNoteForm
        products={products}
        customers={[]}
        initialSales={initialSales}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
      />
    </div>
  );
};

export default EditCreditNotePage;
