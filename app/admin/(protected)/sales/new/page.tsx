export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: must match createSale tx timeout (180s) + response time

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import SaleForm from "./SaleForm";
import { activeOrReferencedWhere, getTransactionCustomers, getTransactionSuppliers } from "@/lib/transaction-options";
import { isInventoryTracked } from "@/lib/inventory-tracking";

const NewSalePage = async () => {
  await requirePermission("sales.create");

  const [rawProducts, customers, config, suppliers, cashBankAccounts] = await Promise.all([
    db.product.findMany({
      where: activeOrReferencedWhere(),
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true, salePrice: true, saleUnitName: true,
        warrantyDays: true, preferredSupplierId: true, inventoryTracking: true, isLotControl: true,
        lotIssueMethod: true, allowExpiredIssue: true,
        category: { select: { name: true } }, brand: { select: { name: true } },
        aliases: { select: { alias: true } }, preferredSupplier: { select: { name: true, isActive: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    getTransactionCustomers(),
    getSiteConfig(),
    getTransactionSuppliers(),
    getActiveCashBankAccountOptions(),
  ]);
  const products = rawProducts.map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    salePrice: Number(product.salePrice), saleUnitName: product.saleUnitName,
    warrantyDays: product.warrantyDays, categoryName: product.category.name,
    brandName: product.brand?.name ?? null, aliases: product.aliases.map((alias) => alias.alias),
    units: product.units.map((unit) => ({ name: unit.name, scale: Number(unit.scale), isBase: unit.isBase })),
    preferredSupplierId: product.preferredSupplier?.isActive ? product.preferredSupplierId : null,
    preferredSupplierName: product.preferredSupplier?.isActive ? product.preferredSupplier.name : null,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    lotIssueMethod: product.lotIssueMethod as string,
    allowExpiredIssue: product.allowExpiredIssue,
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/sales"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รายการขายทั้งหมด
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">บันทึกการขายใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">บันทึกการขายสินค้า</h1>
      <SaleForm
        products={products}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        customers={customers}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
      />
    </div>
  );
};

export default NewSalePage;
