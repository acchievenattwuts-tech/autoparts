export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
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
import SaleForm from "../../new/SaleForm";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import { getTransactionCustomers, getTransactionSuppliers } from "@/lib/transaction-options";
import { isInventoryTracked } from "@/lib/inventory-tracking";

const EditSalePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("sales.update");
  const { role, permissions } = await getSessionPermissionContext();
  const canPrint = hasPermissionAccess(role, permissions, "sales.view");

  const { id } = await params;

  const [sale, config, cashBankAccounts] = await Promise.all([
    db.sale.findUnique({
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
            lotItems: { select: { lotNo: true, qty: true, unitCost: true } },
          },
        },
      },
    }),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  if (!sale) notFound();
  if (sale.status === "CANCELLED") redirect(`/admin/sales/${id}`);

  const salePayments = await db.documentPayment.findMany({
    where: { docType: "SALE", docId: id },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    select: { cashBankAccountId: true, amount: true },
  });

  const mutationBlock = await checkDocumentMutation("Sale", id, "update");
  const mutationBlockMessage = buildMutationBlockMessage(mutationBlock);
  const mutationBlockReferences = buildMutationBlockReferenceLinks(mutationBlock);

  const saleProductIds = [...new Set(sale.items.map((item) => item.productId))];
  const saleSupplierIds = [...new Set(sale.items.map((item) => item.supplierId).filter((supplierId): supplierId is string => !!supplierId))];
  const [rawProducts, customers, suppliers] = await Promise.all([
    db.product.findMany({
          orderBy: { code: "asc" },
          select: {
            id: true, code: true, name: true, description: true, isActive: true,
            salePrice: true, retailPrice: true, saleUnitName: true, warrantyDays: true,
            preferredSupplierId: true, inventoryTracking: true, isLotControl: true, lotIssueMethod: true, allowExpiredIssue: true,
            category:          { select: { name: true } },
            brand:             { select: { name: true } },
            aliases:           { select: { alias: true } },
            preferredSupplier: { select: { name: true, isActive: true } },
            units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
          },
        }),
    getTransactionCustomers([sale.customerId]),
    getTransactionSuppliers(saleSupplierIds),
  ]);

  // Join ProductLot to get expDate for each SaleItemLot
  const lotKeys = sale.items.flatMap((item) =>
    item.lotItems.map((lot) => ({ productId: item.productId, lotNo: lot.lotNo }))
  );
  const productLotExpMap: Record<string, string> = {};
  const productLotMetaMap: Record<string, { expDate: string; mfgDate: string; unitCost: number }> = {};
  if (lotKeys.length > 0) {
    const productLots = await db.productLot.findMany({
      where: { OR: lotKeys },
      select: { productId: true, lotNo: true, expDate: true, mfgDate: true, unitCost: true },
    });
    for (const pl of productLots) {
      productLotExpMap[`${pl.productId}:${pl.lotNo}`] = pl.expDate ? formatDateOnlyForInput(pl.expDate) : "";
      productLotMetaMap[`${pl.productId}:${pl.lotNo}`] = {
        expDate: pl.expDate ? formatDateOnlyForInput(pl.expDate) : "",
        mfgDate: pl.mfgDate ? formatDateOnlyForInput(pl.mfgDate) : "",
        unitCost: Number(pl.unitCost),
      };
    }
  }

  const lotBalanceRows = saleProductIds.length
    ? await db.lotBalance.findMany({
        where: {
          OR: [
            { productId: { in: saleProductIds }, qtyOnHand: { gt: 0 } },
            ...(lotKeys.length > 0 ? lotKeys : []),
          ],
        },
        select: { productId: true, lotNo: true, qtyOnHand: true },
      })
    : [];

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    salePrice: Number(p.salePrice), retailPrice: Number(p.retailPrice), saleUnitName: p.saleUnitName ?? "",
    warrantyDays: p.warrantyDays ?? 0,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
    preferredSupplierId:   p.preferredSupplier?.isActive ? p.preferredSupplierId : null,
    preferredSupplierName: p.preferredSupplier?.isActive ? p.preferredSupplier.name : null,
    isLotControl:          isInventoryTracked(p.inventoryTracking) && p.isLotControl,
    lotIssueMethod:        p.lotIssueMethod as string,
    allowExpiredIssue:     p.allowExpiredIssue,
    isActive:              p.isActive,
  }));

  const initialItems = sale.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    const displayUnitName = item.showUnitName ?? baseUnit?.name ?? "";
    const displayScale = Number(item.unitScale ?? baseUnit?.scale ?? 1) || 1;
    const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.quantity) / displayScale;
    const displaySalePrice =
      item.showPricePerUnit != null
        ? Number(item.showPricePerUnit)
        : Number(item.salePrice);
    // Legacy rows may have unitListPrice = 0 (pre-feature); fall back to the
    // net price so the "list price" never renders below the actual price.
    const displayListPrice = Math.max(Number(item.unitListPrice), displaySalePrice);
    return {
      productId:    item.productId,
      unitName:     displayUnitName,
      qty:          displayQty,
      salePrice:    displaySalePrice,
      unitListPrice: displayListPrice,
      lineDiscount: Number(item.lineDiscount),
      warrantyDays: item.warrantyDays ?? 0,
      supplierId:   item.supplierId ?? "",
      supplierName: item.supplierName ?? "",
      moreDetail:   item.moreDetail ?? "",
      lotItems:     item.lotItems.map((lot) => ({
        lotNo:    lot.lotNo,
        qty:      Number(lot.qty) / displayScale,
        unitCost: Number(lot.unitCost),
        mfgDate:  "",
        expDate:  productLotExpMap[`${item.productId}:${lot.lotNo}`] ?? "",
      })),
    };
  });

  const initialAvailableLots: Record<number, LotAvailableJSON[]> = {};
  sale.items.forEach((item, itemIndex) => {
    const optionMap = new Map<string, LotAvailableJSON>();

    lotBalanceRows
      .filter((balance) => balance.productId === item.productId)
      .forEach((balance) => {
        const meta = productLotMetaMap[`${balance.productId}:${balance.lotNo}`];
        optionMap.set(balance.lotNo, {
          lotNo: balance.lotNo,
          qtyOnHand: Number(balance.qtyOnHand),
          unitCost: meta?.unitCost ?? 0,
          expDate: meta?.expDate || null,
          mfgDate: meta?.mfgDate || null,
        });
      });

    item.lotItems.forEach((lot) => {
      const existingOption = optionMap.get(lot.lotNo);
      const meta = productLotMetaMap[`${item.productId}:${lot.lotNo}`];
      optionMap.set(lot.lotNo, {
        lotNo: lot.lotNo,
        qtyOnHand: (existingOption?.qtyOnHand ?? 0) + Number(lot.qty),
        unitCost: existingOption?.unitCost ?? meta?.unitCost ?? Number(lot.unitCost),
        expDate: existingOption?.expDate ?? meta?.expDate ?? null,
        mfgDate: existingOption?.mfgDate ?? meta?.mfgDate ?? null,
      });
    });

    initialAvailableLots[itemIndex] = Array.from(optionMap.values()).sort((left, right) =>
      left.lotNo.localeCompare(right.lotNo),
    );
  });

  const initialData = {
    id,
      saleDate:        formatDateOnlyForInput(sale.saleDate),
    customerId:      sale.customerId ?? "",
    customerName:    sale.customerName ?? "",
    customerPhone:   sale.customerPhone ?? "",
    saleType:        sale.saleType,
    paymentType:     sale.paymentType as "CASH_SALE" | "CREDIT_SALE",
    paymentMethod:   sale.paymentMethod ?? "",
    cashBankAccountId: sale.cashBankAccountId ?? "",
    payments: salePayments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: Number(payment.amount),
    })),
    fulfillmentType: sale.fulfillmentType as "PICKUP" | "DELIVERY",
    shippingAddress: sale.shippingAddress ?? "",
    shippingFee:     Number(sale.shippingFee ?? 0),
    shippingMethod:  sale.shippingMethod ?? "NONE",
    discount:        Number(sale.discount ?? 0),
    note:            sale.note ?? "",
    vatType:         sale.vatType,
    vatRate:         Number(sale.vatRate),
    creditTerm:      sale.creditTerm ?? null,
    destLatitude:    sale.destLatitude ?? null,
    destLongitude:   sale.destLongitude ?? null,
    items:           initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <NavLink href={`/admin/sales/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> {sale.saleNo}
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">แก้ไขใบขาย</h1>
      {mutationBlockMessage && (
        <div className="mb-6">
          <DocumentMutationBlockedNotice
            message={mutationBlockMessage}
            references={mutationBlockReferences}
          />
        </div>
      )}
      <SaleForm
        products={products}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        customers={customers.map((c) => ({ ...c, priceTier: c.customerType?.priceTier ?? "RETAIL" }))}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
        editableLotOnEdit
        initialAvailableLots={initialAvailableLots}
        submitLocked={!!mutationBlockMessage}
        canPrint={canPrint}
      />
    </div>
  );
};

export default EditSalePage;
