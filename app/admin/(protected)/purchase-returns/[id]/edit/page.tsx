export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import { formatDateOnlyForInput } from "@/lib/th-date";
import PurchaseReturnForm from "../../new/PurchaseReturnForm";

const EditPurchaseReturnPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("purchase_returns.update");

  const { id } = await params;

  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            select: { units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } } },
          },
          lotItems: { select: { lotNo: true, qty: true } },
        },
      },
    },
  });

  if (!ret) notFound();
  if (ret.status === "CANCELLED") redirect(`/admin/purchase-returns/${id}`);

  const currentProductIds = [...new Set(ret.items.map((item) => item.productId))];

  const [rawProducts, suppliers, config, cashBankAccounts] = await Promise.all([
    currentProductIds.length === 0
      ? Promise.resolve([])
      : db.product.findMany({
          where: { id: { in: currentProductIds } },
          select: {
            id: true, code: true, name: true, description: true, avgCost: true,
            isLotControl: true,
            category: { select: { name: true } }, brand: { select: { name: true } },
            aliases:  { select: { alias: true } },
            units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
          },
        }),
    ret.supplierId
      ? db.supplier.findMany({
          where: { id: ret.supplierId },
          select: { id: true, name: true },
          take: 1,
        })
      : Promise.resolve([]),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  const initialPurchases = ret.supplierId
    ? await db.purchase.findMany({
        where:   { supplierId: ret.supplierId },
        orderBy: { purchaseDate: "desc" },
        take:    200,
        select:  { id: true, purchaseNo: true, purchaseDate: true },
      })
    : [];

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description, avgCost: Number(p.avgCost),
    isLotControl: p.isLotControl,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  const initialItems = ret.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    return {
      productId: item.productId,
      unitName:  baseUnit?.name ?? "",
      qty:       Number(item.qty),
      lotItems: item.lotItems.map((lot) => ({
        lotNo: lot.lotNo,
        qty: Number(lot.qty),
        unitCost: Number(item.costPrice),
        mfgDate: "",
        expDate: "",
      })),
    };
  });

  const initialData = {
    id,
      returnDate: formatDateOnlyForInput(ret.returnDate),
    purchaseId: ret.purchaseId ?? "",
    supplierId: ret.supplierId ?? "",
    type: ret.type,
    settlementType: ret.settlementType,
    cashBankAccountId: ret.cashBankAccountId ?? "",
    note:       ret.note ?? "",
    vatType:    ret.vatType,
    vatRate:    Number(ret.vatRate),
    items:      initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/purchase-returns/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> {ret.returnNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขใบคืนสินค้า</h1>
      <PurchaseReturnForm
        products={products}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        initialPurchases={initialPurchases}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
      />
    </div>
  );
};

export default EditPurchaseReturnPage;
