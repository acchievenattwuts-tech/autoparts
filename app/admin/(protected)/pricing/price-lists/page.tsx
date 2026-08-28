export const dynamic = "force-dynamic";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import PriceListManager from "./PriceListManager";

export default async function PriceListsPage() {
  await requirePermission("price_lists.view");
  const [priceLists, totalProducts] = await Promise.all([
    db.priceList.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, code: true, name: true, channel: true, isActive: true, isSystem: true, sortOrder: true,
        _count: { select: { productPrices: true, customerTypes: true } },
      },
    }),
    db.product.count(),
  ]);
  return (
    <div className="space-y-5">
      <AdminPageHeader title="Price List" description="กำหนดชุดราคาที่ประเภทลูกค้าและช่องทางขายเลือกใช้ ราคาแต่ละสินค้าจัดการจากหน้าสินค้า" />
      <PriceListManager
        totalProducts={totalProducts}
        rows={priceLists.map((row) => ({
          id: row.id, code: row.code, name: row.name, channel: row.channel,
          isActive: row.isActive, isSystem: row.isSystem,
          sortOrder: row.sortOrder,
          productCount: row._count.productPrices, customerTypeCount: row._count.customerTypes,
        }))}
      />
    </div>
  );
}
