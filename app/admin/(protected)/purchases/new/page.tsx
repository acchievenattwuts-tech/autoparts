export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PurchaseForm from "./PurchaseForm";

const NewPurchasePage = async () => {
  await requirePermission("purchases.create");

  const [rawProducts, suppliers, config] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true,
        purchaseUnitName: true, costPrice: true,
        isLotControl: true, requireExpiryDate: true,
        category: { select: { name: true } },
        brand:    { select: { name: true } },
        aliases:  { select: { alias: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSiteConfig(),
  ]);

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    purchaseUnitName: p.purchaseUnitName ?? "", costPrice: Number(p.costPrice),
    isLotControl: p.isLotControl, requireExpiryDate: p.requireExpiryDate,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/purchases"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> ใบซื้อทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">สร้างใบซื้อใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">สร้างใบซื้อสินค้า</h1>
      <PurchaseForm products={products} suppliers={suppliers} defaultVatType={config.vatType} defaultVatRate={config.vatRate} />
    </div>
  );
};

export default NewPurchasePage;
