export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PurchaseReturnForm from "./PurchaseReturnForm";

const NewPurchaseReturnPage = async () => {
  await requirePermission("purchase_returns.create");

  const config = await getSiteConfig();

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
        products={[]}
        suppliers={[]}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
      />
    </div>
  );
};

export default NewPurchaseReturnPage;
