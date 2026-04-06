export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import SaleForm from "./SaleForm";

const NewSalePage = async () => {
  await requirePermission("sales.create");

  const [customers, config, suppliers] = await Promise.all([
    db.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, code: true, shippingAddress: true },
    }),
    getSiteConfig(),
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/sales"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> รายการขายทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">บันทึกการขายใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">บันทึกการขายสินค้า</h1>
      <SaleForm products={[]} suppliers={suppliers} customers={customers} defaultVatType={config.vatType} defaultVatRate={config.vatRate} />
    </div>
  );
};

export default NewSalePage;
