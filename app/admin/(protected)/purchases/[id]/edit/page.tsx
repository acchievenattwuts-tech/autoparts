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
import PurchaseForm from "../../new/PurchaseForm";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import { getTransactionSuppliers } from "@/lib/transaction-options";

const EditPurchasePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("purchases.update");

  const { id } = await params;

  const [purchase, config, cashBankAccounts] = await Promise.all([
    db.purchase.findUnique({
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
            lotItems: { select: { lotNo: true, qty: true, unitCost: true, mfgDate: true, expDate: true } },
          },
        },
      },
    }),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  if (!purchase) notFound();
  if (purchase.status === "CANCELLED") redirect(`/admin/purchases/${id}`);

  const purchasePayments = await db.documentPayment.findMany({
    where: { docType: "PURCHASE", docId: id },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    select: { cashBankAccountId: true, amount: true },
  });

  const mutationBlock = await checkDocumentMutation("Purchase", id, "update");
  const mutationBlockMessage = buildMutationBlockMessage(mutationBlock);
  const mutationBlockReferences = buildMutationBlockReferenceLinks(mutationBlock);

  const suppliers = await getTransactionSuppliers([purchase.supplierId]);
  const rawProducts = await db.product.findMany({
        orderBy: { code: "asc" },
        select: {
          id: true, code: true, name: true, description: true, isActive: true,
          purchaseUnitName: true, costPrice: true, inventoryTracking: true,
          isLotControl: true, requireExpiryDate: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
          aliases: { select: { alias: true } },
          units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
        },
      });

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    purchaseUnitName: p.purchaseUnitName, costPrice: Number(p.costPrice),
    isLotControl: isInventoryTracked(p.inventoryTracking) && p.isLotControl, requireExpiryDate: p.requireExpiryDate,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
    isActive: p.isActive,
  }));

  const initialItems = purchase.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    const displayUnitName = item.showUnitName ?? baseUnit?.name ?? "";
    const displayScale = Number(item.unitScale ?? baseUnit?.scale ?? 1) || 1;
    const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.quantity) / displayScale;
    const displayCostPrice =
      item.showPricePerUnit != null
        ? Number(item.showPricePerUnit)
        : Number(item.costPrice) * displayScale;
    return {
      productId: item.productId,
      unitName: displayUnitName,
      qty: displayQty,
      costPrice: displayCostPrice,
      landedCost: Number(item.landedCost) * displayQty,
      moreDetail: item.moreDetail ?? "",
      lotItems: item.lotItems.map((lot) => ({
        lotNo: lot.lotNo,
        qty: Number(lot.qty) / displayScale,
        unitCost: Number(lot.unitCost) * displayScale,
          mfgDate: lot.mfgDate ? formatDateOnlyForInput(lot.mfgDate) : "",
          expDate: lot.expDate ? formatDateOnlyForInput(lot.expDate) : "",
      })),
    };
  });
  const initialData = {
    id,
      purchaseDate: formatDateOnlyForInput(purchase.purchaseDate),
    supplierId: purchase.supplierId ?? "",
    purchaseType: purchase.purchaseType,
    cashBankAccountId: purchase.cashBankAccountId ?? "",
    payments: purchasePayments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: Number(payment.amount),
    })),
    referenceNo: purchase.referenceNo ?? "",
    discount: Number(purchase.discount),
    shippingFee: Number(purchase.shippingFee),
    note: purchase.note ?? "",
    vatType: purchase.vatType,
    vatRate: Number(purchase.vatRate),
    creditTerm: purchase.creditTerm,
    items: initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <NavLink
          href={`/admin/purchases/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> {purchase.purchaseNo}
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">แก้ไขใบซื้อสินค้า</h1>
      {mutationBlockMessage && (
        <div className="mb-6">
          <DocumentMutationBlockedNotice
            message={mutationBlockMessage}
            references={mutationBlockReferences}
          />
        </div>
      )}
      <PurchaseForm
        products={products}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
        editableLotOnEdit
        submitLocked={!!mutationBlockMessage}
      />
    </div>
  );
};

export default EditPurchasePage;
