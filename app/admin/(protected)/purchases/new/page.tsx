export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: must match createPurchase tx timeout (180s) + response time

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PurchaseForm from "./PurchaseForm";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { getTransactionSuppliers } from "@/lib/transaction-options";
import { isInventoryTracked } from "@/lib/inventory-tracking";

const NewPurchasePage = async () => {
  await requirePermission("purchases.create");

  const [rawProducts, suppliers, config, cashBankAccounts] = await Promise.all([
    db.product.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true, purchaseUnitName: true, costPrice: true,
        inventoryTracking: true, isLotControl: true, requireExpiryDate: true, isActive: true,
        category: { select: { name: true } }, brand: { select: { name: true } },
        aliases: { select: { alias: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    getTransactionSuppliers(),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);
  const products = rawProducts.map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    purchaseUnitName: product.purchaseUnitName, costPrice: Number(product.costPrice),
    categoryName: product.category.name, brandName: product.brand?.name ?? null,
    aliases: product.aliases.map((alias) => alias.alias),
    units: product.units.map((unit) => ({ name: unit.name, scale: Number(unit.scale), isBase: unit.isBase })),
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    requireExpiryDate: product.requireExpiryDate,
    isActive: product.isActive,
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/purchases"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> ใบซื้อทั้งหมด
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">สร้างใบซื้อใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">สร้างใบซื้อสินค้า</h1>
      <PurchaseForm products={products} suppliers={suppliers} cashBankAccounts={cashBankAccounts} defaultVatType={config.vatType} defaultVatRate={config.vatRate} />
    </div>
  );
};

export default NewPurchasePage;
