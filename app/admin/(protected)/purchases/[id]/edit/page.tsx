export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { formatDateOnlyForInput } from "@/lib/th-date";
import PurchaseForm from "../../new/PurchaseForm";

const EditPurchasePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("purchases.update");

  const { id } = await params;

  const [purchase, rawProducts, suppliers, config, cashBankAccounts] = await Promise.all([
    db.purchase.findUnique({
      where: { id },
      include: {
        items: {
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
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true,
        purchaseUnitName: true, costPrice: true,
        isLotControl: true, requireExpiryDate: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        aliases: { select: { alias: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  if (!purchase) notFound();
  if (purchase.status === "CANCELLED") redirect(`/admin/purchases/${id}`);

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    purchaseUnitName: p.purchaseUnitName, costPrice: Number(p.costPrice),
    isLotControl: p.isLotControl, requireExpiryDate: p.requireExpiryDate,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  // Convert stored items (base unit qty + cost per base) back to display format using base unit
  const initialItems = purchase.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    return {
      productId: item.productId,
      unitName: baseUnit?.name ?? "",
      qty: item.quantity,
      costPrice: Number(item.costPrice),
      landedCost: Number(item.landedCost) * item.quantity,
      lotItems: item.lotItems.map((lot) => ({
        lotNo: lot.lotNo,
        qty: Number(lot.qty),
        unitCost: Number(lot.unitCost),
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
    referenceNo: purchase.referenceNo ?? "",
    discount: Number(purchase.discount),
    note: purchase.note ?? "",
    vatType: purchase.vatType,
    vatRate: Number(purchase.vatRate),
    items: initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href={`/admin/purchases/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> {purchase.purchaseNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขใบซื้อสินค้า</h1>
      <PurchaseForm
        products={products}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
        editableLotOnEdit
      />
    </div>
  );
};

export default EditPurchasePage;
