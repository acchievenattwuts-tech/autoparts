export const dynamic = "force-dynamic";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput, getThailandDateKey } from "@/lib/th-date";
import PromotionManager from "./PromotionManager";

export default async function PricePromotionsPage() {
  await requirePermission("price_promotions.view");
  const [priceLists, products, promotions] = await Promise.all([
    db.priceList.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true } }),
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.pricePromotion.findMany({
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, name: true, startDate: true, endDate: true, status: true, note: true, priceListId: true,
        priceList: { select: { name: true } },
        items: {
          orderBy: { product: { code: "asc" } },
          select: { productId: true, normalReferencePrice: true, promotionPrice: true, product: { select: { code: true, name: true } } },
        },
      },
    }),
  ]);
  return (
    <div className="space-y-5">
      <AdminPageHeader title="โปรโมชั่นราคา" description="Scheduled price override ตามวันที่ขายในบิล ไม่ใช่ระบบคูปองหรือ promotion engine ทั่วไป" />
      <PromotionManager
        today={getThailandDateKey()}
        priceLists={priceLists.map((row) => ({ id: row.id, label: `${row.name} — ${row.code}` }))}
        products={products.map((row) => ({ id: row.id, label: `${row.code} — ${row.name}` }))}
        promotions={promotions.map((row) => ({
          id: row.id,
          name: row.name,
          priceListId: row.priceListId,
          priceListName: row.priceList.name,
          startDate: formatDateOnlyForInput(row.startDate),
          endDate: formatDateOnlyForInput(row.endDate),
          dateRange: `${formatDateOnlyForInput(row.startDate)} – ${formatDateOnlyForInput(row.endDate)}`,
          status: row.status,
          note: row.note,
          itemCount: row.items.length,
          items: row.items.map((item) => ({
            productId: item.productId,
            label: `${item.product.code} — ${item.product.name}`,
            normalReferencePrice: Number(item.normalReferencePrice),
            promotionPrice: Number(item.promotionPrice),
          })),
        }))}
      />
    </div>
  );
}
