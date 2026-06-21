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
import { activeOrReferencedWhere, getTransactionSuppliers } from "@/lib/transaction-options";
import { isInventoryTracked } from "@/lib/inventory-tracking";

const EditPurchaseReturnPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("purchase_returns.update");

  const { id } = await params;

  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        include: {
          product: {
            select: { units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } } },
          },
          lotItems: { select: { lotNo: true, qty: true } },
        },
      },
      claim: {
        select: {
          id: true,
          claimNo: true,
          supplier: { select: { name: true } },
          warranty: {
            select: {
              productId: true,
              product: { select: { code: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!ret) notFound();
  if (ret.status === "CANCELLED") redirect(`/admin/purchase-returns/${id}`);

  const currentProductIds = [...new Set(ret.items.map((item) => item.productId))];

  const [rawProducts, suppliers, config, cashBankAccounts] = await Promise.all([
    db.product.findMany({
          where: activeOrReferencedWhere(currentProductIds),
          orderBy: { code: "asc" },
          select: {
            id: true, code: true, name: true, description: true, avgCost: true, costPrice: true, isActive: true,
            inventoryTracking: true, isLotControl: true,
            category: { select: { name: true } }, brand: { select: { name: true } },
            aliases:  { select: { alias: true } },
            units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
          },
        }),
    getTransactionSuppliers([ret.supplierId]),
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
    costPrice: Number(p.costPrice), inventoryTracking: p.inventoryTracking,
    isLotControl: isInventoryTracked(p.inventoryTracking) && p.isLotControl,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
    isActive: p.isActive,
  }));

  const initialItems = ret.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    const displayUnitName = item.showUnitName ?? baseUnit?.name ?? "";
    const displayScale = Number(item.unitScale ?? baseUnit?.scale ?? 1) || 1;
    const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.qty) / displayScale;
    const displayCostPrice =
      item.showPricePerUnit != null
        ? Number(item.showPricePerUnit)
        : Number(item.costPrice) * displayScale;
    return {
      productId: item.productId,
      unitName:  displayUnitName,
      qty:       displayQty,
      costPrice: displayCostPrice,
      moreDetail: item.moreDetail ?? "",
      lotItems: item.lotItems.map((lot) => ({
        lotNo: lot.lotNo,
        qty: Number(lot.qty) / displayScale,
        unitCost: displayCostPrice,
        mfgDate: "",
        expDate: "",
      })),
    };
  });

  const initialData = {
    id,
      returnDate: formatDateOnlyForInput(ret.returnDate),
    purchaseId: ret.purchaseId ?? "",
    claimId: ret.claimId ?? "",
    supplierId: ret.supplierId ?? "",
    type: ret.type,
    settlementType: ret.settlementType,
    cashBankAccountId: ret.cashBankAccountId ?? "",
    note:       ret.note ?? "",
    vatType:    ret.vatType,
    vatRate:    Number(ret.vatRate),
    items:      initialItems,
  };
  const claimContext = ret.claim
    ? {
        id: ret.claim.id,
        claimNo: ret.claim.claimNo,
        supplierName: ret.claim.supplier?.name ?? null,
        productId: ret.claim.warranty.productId,
        productCode: ret.claim.warranty.product.code,
        productName: ret.claim.warranty.product.name,
      }
    : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/purchase-returns/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> {ret.returnNo}
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">แก้ไขใบคืนสินค้า</h1>
      <PurchaseReturnForm
        products={products}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        initialPurchases={initialPurchases}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
        claimContext={claimContext}
      />
    </div>
  );
};

export default EditPurchaseReturnPage;
