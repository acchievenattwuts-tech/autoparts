export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PurchaseForm from "./PurchaseForm";

const NewPurchasePage = async () => {
  await requirePermission("purchases.create");

  const [suppliers, config] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSiteConfig(),
  ]);

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
      <PurchaseForm products={[]} suppliers={suppliers} defaultVatType={config.vatType} defaultVatRate={config.vatRate} />
    </div>
  );
};

export default NewPurchasePage;
