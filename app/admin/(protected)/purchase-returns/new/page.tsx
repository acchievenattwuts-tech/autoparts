export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PurchaseReturnForm from "./PurchaseReturnForm";

const NewPurchaseReturnPage = async () => {
  await requirePermission("purchase_returns.create");

  const [rawProducts, config, cashBankAccounts] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true, avgCost: true,
        isLotControl: true,
        category: { select: { name: true } },
        brand:    { select: { name: true } },
        aliases:  { select: { alias: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    avgCost: Number(p.avgCost), isLotControl: p.isLotControl,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/purchase-returns"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> รายการคืนสินค้า
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">บันทึกคืนสินค้าใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">คืนสินค้าให้ซัพพลายเออร์</h1>
      <PurchaseReturnForm
        products={products}
        suppliers={[]}
        cashBankAccounts={cashBankAccounts}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
      />
    </div>
  );
};

export default NewPurchaseReturnPage;
